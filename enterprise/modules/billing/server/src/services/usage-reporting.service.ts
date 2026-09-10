import { createLogger } from "@langwatch/observability";
import Stripe from "stripe";
import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
  UsageReportFailedError,
} from "@langwatch/enterprise-billing-contract";
import { z } from "zod";

const logger = createLogger("langwatch:billing:usageReportingService");

const meterEventSchema = z.object({
  eventName: z.string().min(1),
  value: z.number().int().nonnegative(),
  /** Unix SECONDS since epoch. NOT milliseconds, NOT ISO string. */
  timestamp: z.number().int().positive(),
  /** Caller-constructed idempotency key. 24-hour rolling uniqueness window in Stripe. */
  identifier: z.string().min(1),
});

const reportUsageDeltaInputSchema = z.object({
  stripeCustomerId: z.string().startsWith("cus_"),
  organizationId: z.string().min(1),
  events: z.array(meterEventSchema).min(1),
});

const reportUsageSetInputSchema = z.object({
  stripeCustomerId: z.string().startsWith("cus_"),
  organizationId: z.string().min(1),
  events: z
    .array(
      meterEventSchema.extend({
        previouslyReportedValue: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

type ReportUsageDeltaInput = z.infer<typeof reportUsageDeltaInputSchema>;
type ReportUsageSetInput = z.infer<typeof reportUsageSetInputSchema>;

const getUsageSummaryInputSchema = z
  .object({
    stripeCustomerId: z.string().startsWith("cus_"),
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
  });

type GetUsageSummaryInput = z.input<typeof getUsageSummaryInputSchema>;

export type MeterEventResult = {
  identifier: string;
  reported: boolean;
  valueSent: number;
  error?: string;
};

export type UsageSummary = {
  aggregatedValue: number;
  startTime: number;
  endTime: number;
};

export type UsageReportingService = {
  reportUsageDelta(input: ReportUsageDeltaInput): Promise<MeterEventResult[]>;
  reportUsageSet(input: ReportUsageSetInput): Promise<MeterEventResult[]>;
  getUsageSummary(input: GetUsageSummaryInput): Promise<UsageSummary>;
};

export class StripeUsageReportingService implements UsageReportingService {
  private readonly stripe: Stripe;
  private readonly meterId: string;

  private constructor(deps: { stripe: Stripe; meterId: string }) {
    this.stripe = deps.stripe;
    this.meterId = deps.meterId;
  }

  static create(deps: { stripe: Stripe; meterId: string }): StripeUsageReportingService {
    return new StripeUsageReportingService(deps);
  }

  private async sendMeterEvent({
    stripeCustomerId,
    organizationId,
    eventName,
    value,
    timestamp,
    identifier,
  }: {
    stripeCustomerId: string;
    organizationId: string;
    eventName: string;
    value: number;
    timestamp: number;
    identifier: string;
  }): Promise<MeterEventResult> {
    try {
      await this.stripe.billing.meterEvents.create({
        event_name: eventName,
        payload: {
          stripe_customer_id: stripeCustomerId,
          value: String(value),
        },
        identifier,
        timestamp,
      });

      logger.info(
        { organizationId, identifier, valueSent: value, reported: true },
        "[billing] Meter event sent",
      );

      return { identifier, reported: true, valueSent: value };
    } catch (error) {
      if (isStripeInvalidRequestError(error)) {
        if (error.code === "resource_already_exists") {
          logger.info(
            { organizationId, identifier, valueSent: value, reported: true },
            "[billing] Meter event already exists (duplicate identifier)",
          );

          return { identifier, reported: true, valueSent: value };
        }

        logger.warn(
          {
            organizationId,
            identifier,
            valueSent: value,
            reported: false,
            error: error.message,
          },
          "[billing] Meter event rejected by Stripe",
        );

        return {
          identifier,
          reported: false,
          valueSent: 0,
          error: error.message,
        };
      }

      if (isStripeAuthenticationError(error)) {
        logger.warn(
          {
            organizationId,
            identifier,
            valueSent: value,
            reported: false,
            error: error.message,
          },
          "[billing] Stripe authentication error",
        );

        return {
          identifier,
          reported: false,
          valueSent: 0,
          error: error.message,
        };
      }

      // Retryable errors: re-throw for BullMQ retry
      throw error;
    }
  }

  async reportUsageDelta(input: ReportUsageDeltaInput): Promise<MeterEventResult[]> {
    const validated = reportUsageDeltaInputSchema.parse(input);
    const results: MeterEventResult[] = [];

    for (const event of validated.events) {
      if (event.value <= 0) {
        logger.info(
          {
            organizationId: validated.organizationId,
            identifier: event.identifier,
            valueSent: 0,
            reported: false,
          },
          "[billing] Skipping zero-value meter event",
        );
        results.push({
          identifier: event.identifier,
          reported: false,
          valueSent: 0,
        });
        continue;
      }

      const result = await this.sendMeterEvent({
        stripeCustomerId: validated.stripeCustomerId,
        organizationId: validated.organizationId,
        eventName: event.eventName,
        value: event.value,
        timestamp: event.timestamp,
        identifier: event.identifier,
      });
      results.push(result);
    }

    return results;
  }

  async reportUsageSet(input: ReportUsageSetInput): Promise<MeterEventResult[]> {
    const validated = reportUsageSetInputSchema.parse(input);
    const results: MeterEventResult[] = [];

    for (const event of validated.events) {
      const delta = event.value - event.previouslyReportedValue;

      if (delta <= 0) {
        logger.info(
          {
            organizationId: validated.organizationId,
            identifier: event.identifier,
            valueSent: 0,
            reported: false,
          },
          "[billing] Skipping non-positive delta meter event",
        );
        results.push({
          identifier: event.identifier,
          reported: false,
          valueSent: 0,
        });
        continue;
      }

      const result = await this.sendMeterEvent({
        stripeCustomerId: validated.stripeCustomerId,
        organizationId: validated.organizationId,
        eventName: event.eventName,
        value: delta,
        timestamp: event.timestamp,
        identifier: event.identifier,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * The meter read behind {@link getUsageSummary}, with the two named, non-retryable
   * rejections separated from everything else.
   */
  private async listEventSummaries({
    stripeCustomerId,
    startTime,
    endTime,
  }: {
    stripeCustomerId: string;
    startTime: number;
    endTime: number;
  }): Promise<Awaited<ReturnType<Stripe["billing"]["meters"]["listEventSummaries"]>>> {
    try {
      return await this.stripe.billing.meters.listEventSummaries(this.meterId, {
        customer: stripeCustomerId,
        start_time: startTime,
        end_time: endTime,
      });
    } catch (error) {
      if (isStripeInvalidRequestError(error) || isStripeAuthenticationError(error)) {
        logger.error(
          { stripeCustomerId, meterId: this.meterId, error: error.message },
          "[billing] Usage summary rejected by Stripe",
        );

        throw new UsageReportFailedError({ reasons: [error] });
      }

      throw error;
    }
  }

  async getUsageSummary(input: GetUsageSummaryInput): Promise<UsageSummary> {
    const validated = getUsageSummaryInputSchema.parse(input);

    const response = await this.listEventSummaries(validated);

    if (response.data.length === 0) {
      logger.warn(
        {
          stripeCustomerId: validated.stripeCustomerId,
          meterId: this.meterId,
          startTime: validated.startTime,
          endTime: validated.endTime,
        },
        "[billing] Empty usage summary from Stripe — could mean zero usage or misconfigured meter",
      );

      return {
        aggregatedValue: 0,
        startTime: validated.startTime,
        endTime: validated.endTime,
      };
    }

    const aggregatedValue = response.data.reduce((sum, s) => sum + s.aggregated_value, 0);

    logger.info(
      {
        stripeCustomerId: validated.stripeCustomerId,
        meterId: this.meterId,
        aggregatedValue,
        startTime: validated.startTime,
        endTime: validated.endTime,
      },
      "[billing] Usage summary retrieved",
    );

    return {
      aggregatedValue,
      startTime: validated.startTime,
      endTime: validated.endTime,
    };
  }
}

const isStripeInvalidRequestError = (
  error: unknown,
): error is Stripe.errors.StripeInvalidRequestError =>
  error instanceof Error &&
  (error as Stripe.errors.StripeError).type === "StripeInvalidRequestError";

const isStripeAuthenticationError = (
  error: unknown,
): error is Stripe.errors.StripeAuthenticationError =>
  error instanceof Error &&
  (error as Stripe.errors.StripeError).type === "StripeAuthenticationError";

/**
 * The Stripe SDK policy one composed process holds.
 *
 * Frozen twin: `AppStripeRuntime` (`platform/app/src/runtime/app/stripe.runtime.ts`)
 * builds its client with these exact four settings from the same
 * `STRIPE_SECRET_KEY`. The API version is the one both graphs report meter
 * events against, so it may not drift on one side: a client pinned to a
 * different version can be told about a meter event shape the other never
 * sends.
 */
const STRIPE_API_VERSION = "2024-04-10" as const;
const STRIPE_MAX_NETWORK_RETRIES = 1;
const STRIPE_TELEMETRY = true;

/** A SaaS process that cannot reach Stripe has no usage to report through. */
export class StripeUsageReportingUnavailable extends Error {
  readonly name = "StripeUsageReportingUnavailable";

  constructor() {
    super("A Stripe secret key is required for SaaS billing runtime");
  }
}

/**
 * Constructs the meter-event sender the monthly roll-up reports through.
 *
 * The meter id comes from the checked-in price catalogue, keyed by the same
 * environment reading the App uses — `production` is Stripe's live mode and
 * everything else is test — so the two graphs cannot report into two different
 * meters for one deployment.
 *
 * Refusing without a key rather than degrading is deliberate, and it is the
 * refusal the App already makes: a SaaS process whose reporting service is
 * absent counts every billable event correctly and reports none of them, which
 * is revenue present in ClickHouse, absent from Stripe, and visible nowhere
 * else. A self-hosted process composes no sender at all and never asks.
 */
export class StripeUsageReportingBuilder {
  static create(options: {
    secretKey: string | undefined;
    nodeEnvironment: string | undefined;
  }): StripeUsageReportingBuilder {
    return new StripeUsageReportingBuilder(options.secretKey, options.nodeEnvironment);
  }

  private constructor(
    private readonly secretKey: string | undefined,
    private readonly nodeEnvironment: string | undefined,
  ) {}

  build(): UsageReportingService {
    if (!this.secretKey) throw new StripeUsageReportingUnavailable();

    return StripeUsageReportingService.create({
      stripe: new Stripe(this.secretKey, {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
        telemetry: STRIPE_TELEMETRY,
      }),
      meterId: BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(this.nodeEnvironment))
        .meters.BILLABLE_EVENTS,
    });
  }
}

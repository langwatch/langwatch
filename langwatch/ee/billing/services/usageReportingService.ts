import type Stripe from "stripe";
import { z } from "zod";
import { createLogger } from "../../../src/utils/logger";

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
      })
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

export const createUsageReportingService = ({
  stripe,
  meterId,
}: {
  stripe: Stripe;
  meterId: string;
}): UsageReportingService => {
  const sendMeterEvent = async ({
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
  }): Promise<MeterEventResult> => {
    try {
      await stripe.billing.meterEvents.create({
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
        "[billing] Meter event sent"
      );

      return { identifier, reported: true, valueSent: value };
    } catch (error) {
      if (isStripeInvalidRequestError(error)) {
        if (error.code === "resource_already_exists") {
          logger.info(
            { organizationId, identifier, valueSent: value, reported: true },
            "[billing] Meter event already exists (duplicate identifier)"
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
          "[billing] Meter event rejected by Stripe"
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
          "[billing] Stripe authentication error"
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
  };

  return {
    async reportUsageDelta(input) {
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
            "[billing] Skipping zero-value meter event"
          );
          results.push({
            identifier: event.identifier,
            reported: false,
            valueSent: 0,
          });
          continue;
        }

        const result = await sendMeterEvent({
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
    },

    async reportUsageSet(input) {
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
            "[billing] Skipping non-positive delta meter event"
          );
          results.push({
            identifier: event.identifier,
            reported: false,
            valueSent: 0,
          });
          continue;
        }

        const result = await sendMeterEvent({
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
    },

    async getUsageSummary(input) {
      const validated = getUsageSummaryInputSchema.parse(input);

      const response = await stripe.billing.meters.listEventSummaries(
        meterId,
        {
          customer: validated.stripeCustomerId,
          start_time: validated.startTime,
          end_time: validated.endTime,
        }
      );

      const summary = response.data[0];

      if (!summary) {
        logger.warn(
          {
            stripeCustomerId: validated.stripeCustomerId,
            meterId,
            startTime: validated.startTime,
            endTime: validated.endTime,
          },
          "[billing] Empty usage summary from Stripe — could mean zero usage or misconfigured meter"
        );

        return {
          aggregatedValue: 0,
          startTime: validated.startTime,
          endTime: validated.endTime,
        };
      }

      const aggregatedValue = summary.aggregated_value;

      logger.info(
        {
          stripeCustomerId: validated.stripeCustomerId,
          meterId,
          aggregatedValue,
          startTime: validated.startTime,
          endTime: validated.endTime,
        },
        "[billing] Usage summary retrieved"
      );

      return {
        aggregatedValue,
        startTime: validated.startTime,
        endTime: validated.endTime,
      };
    },
  };
};

const isStripeInvalidRequestError = (
  error: unknown
): error is Stripe.errors.StripeInvalidRequestError =>
  error instanceof Error &&
  (error as Stripe.errors.StripeError).type === "StripeInvalidRequestError";

const isStripeAuthenticationError = (
  error: unknown
): error is Stripe.errors.StripeAuthenticationError =>
  error instanceof Error &&
  (error as Stripe.errors.StripeError).type === "StripeAuthenticationError";

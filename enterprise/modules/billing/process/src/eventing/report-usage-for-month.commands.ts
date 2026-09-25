import {
  BILLING_REPORT_COMMAND_TYPES,
  reportUsageForMonthCommandDataSchema,
  type ReportUsageForMonthCommandData,
  type UsageBillingContract,
} from "@langwatch/enterprise-billing-contract";
import type { Command, CommandHandler, Event } from "@langwatch/eventing";
import { defineCommandSchema } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";

import type { BillingCheckpointRepository } from "../repositories/billing-checkpoint.repository.ts";
import type { BillingOrganizationCacheRepository } from "../repositories/billing-organization-cache.repository.ts";
import type { BillingReportOrganizationRepository } from "../repositories/billing-report-organization.repository.ts";
import {
  instantEvalMeterIdentifier,
  instantEvalMeterUnitsToUsd,
  INSTANT_EVAL_USD_EVENT_NAME,
} from "../rules/instant-eval-meter.rules.ts";
import { meterEventTimestampSeconds } from "../rules/meter-event-timestamp.rules.ts";
import {
  BillableEventsQueryService,
  type BillableEventsTotalResult,
} from "../services/billable-events-query.service.ts";
import type { BillingErrorReporter } from "../services/billing-error-reporter.service.ts";
import type { InstantEvalSpendQueryService } from "../services/instant-eval-spend-query.service.ts";
import type { UsageReportingService } from "../services/usage-reporting.service.ts";

const logger = createLogger("langwatch:billing-reporting:report-usage-for-month");

/** Stripe meter event name for billable events. */
export const BILLABLE_EVENTS_EVENT_NAME = "langwatch_billable_events";

/**
 * One meter the month is reported on. Each keeps its own checkpoint and its
 * own unit — the events meter counts, the Instant Evals meter holds
 * ten-thousandths of a dollar — and what is shared is the protocol around them.
 */
interface BillingMeter {
  readonly eventName: string;
  /** The most this month may report for a capped contract, or null for no cap. */
  readonly ceiling: (args: {
    organizationId: string;
    billingMonth: string;
    contract: UsageBillingContract;
  }) => Promise<number | null>;
  /** The month's running total in the meter's own integer unit. */
  readonly queryTotal: (args: {
    organizationId: string;
    billingMonth: string;
  }) => Promise<BillableEventsTotalResult>;
  /** The delta as the meter event carries it. */
  readonly toValue: (deltaUnits: number) => number;
  /** The deterministic idempotency key for one delta. */
  readonly identifier: (args: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    targetTotal: number;
  }) => string;
}

/** Maximum consecutive failures before circuit-breaker trips. */
const MAX_CONSECUTIVE_FAILURES = 5;

/** Normalises a thrown value to an Error without losing a non-Error payload. */
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : JSON.stringify(value));
}

export interface ReportUsageForMonthCommandDeps {
  organizations: BillingReportOrganizationRepository;
  billingCheckpoints: BillingCheckpointRepository;
  getUsageReportingService: () => UsageReportingService | undefined;
  /** `{ outcome: "unavailable" }` means ClickHouse was unreachable, and the
   *  caller must skip the month rather than report a total it did not read —
   *  a distinct outcome from a verified `{ outcome: "counted"; total: 0 }`. */
  queryBillableEventsTotal: BillableEventsQueryService["queryBillableEventsTotal"];
  /** The Instant Evals meter's total, read off the gateway spend ledger. */
  queryInstantEvalSpendTotal: InstantEvalSpendQueryService["queryInstantEvalSpendTotal"];
  selfDispatch: (data: ReportUsageForMonthCommandData) => Promise<void>;
  /** Shared organization-read cache; see `billing-organization-cache.repository.ts`. */
  organizationCache: BillingOrganizationCacheRepository;
  /** Where an unexpected failure in this handler is reported. */
  errorReporter: BillingErrorReporter;
  /**
   * The most hosted usage a connected customer's month may report, or null.
   * The gateway's 60 second budget refresh lets the ledger run past the
   * commit, and the credit grant covers the commit exactly (ADR-156 §7).
   */
  connectedUsageCeiling: (input: {
    organizationId: string;
    billingMonth: string;
  }) => Promise<number | null>;
}

const SCHEMA = defineCommandSchema(
  BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
  reportUsageForMonthCommandDataSchema,
  "Command to report usage for a billing month to Stripe",
);

/**
 * The events meter's identifier predates the second meter, so it keeps the
 * shape it always had: an identifier is what stops a redelivered delta being
 * charged twice, and renaming it across a deploy would break exactly that.
 */
function billableEventsIdentifier({
  organizationId,
  billingMonth,
  lastReportedTotal,
  targetTotal,
}: {
  organizationId: string;
  billingMonth: string;
  lastReportedTotal: number;
  targetTotal: number;
}): string {
  return `${organizationId}:${billingMonth}:from:${lastReportedTotal}:to:${targetTotal}`;
}

/** When the billing month ended, in epoch milliseconds. */
function billingMonthEndMs(billingMonth: string): number {
  const [, end] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

  return Temporal.Instant.from(`${end.replace(" ", "T")}Z`).epochMilliseconds;
}

/**
 * A Cloud customer is invoiced monthly, so its events stay at the time of
 * reporting rather than behind a closed period. A connected customer is
 * invoiced quarterly (ADR-156 §7), so the month is open and dated there.
 */
function meterTimestampFor({
  contract,
  billingMonth,
  nowMs,
}: {
  contract: UsageBillingContract;
  billingMonth: string;
  nowMs: number;
}): number {
  return meterEventTimestampSeconds({
    periodEndMs: contract === "connected" ? billingMonthEndMs(billingMonth) : nowMs,
    nowMs,
  });
}

/**
 * The total the month reports, never above what the contract agreed. A total
 * past the ceiling is the gateway's 60 second refresh letting spend overshoot
 * the budget; the ledger keeps the real figure, the invoice the agreed one.
 */
function totalWithinContractCeiling({
  measured,
  ceiling,
  organizationId,
  billingMonth,
  meter,
}: {
  measured: number;
  ceiling: number | null;
  organizationId: string;
  billingMonth: string;
  meter: BillingMeter;
}): number {
  if (ceiling === null || measured <= ceiling) return measured;

  logger.info(
    { organizationId, billingMonth, meter: meter.eventName, measured, ceiling },
    "hosted usage ran past the contract ceiling; reporting the ceiling",
  );

  return ceiling;
}

/**
 * Reports usage to Stripe via two-phase checkpoints and self-dispatch convergence.
 * Handles all errors internally; framework sees every job as successful.
 */
export class ReportUsageForMonthCommandHandler implements CommandHandler<
  Command<ReportUsageForMonthCommandData>,
  Event
> {
  static readonly schema = SCHEMA;

  static create(deps: ReportUsageForMonthCommandDeps): ReportUsageForMonthCommandHandler {
    return new ReportUsageForMonthCommandHandler(deps);
  }

  private readonly meters: readonly BillingMeter[];

  constructor(private readonly deps: ReportUsageForMonthCommandDeps) {
    this.meters = [
      {
        eventName: BILLABLE_EVENTS_EVENT_NAME,
        ceiling: async () => null,
        queryTotal: (args) => deps.queryBillableEventsTotal(args),
        toValue: (delta) => delta,
        identifier: billableEventsIdentifier,
      },
      {
        eventName: INSTANT_EVAL_USD_EVENT_NAME,
        ceiling: ({ contract, ...args }) =>
          contract === "connected" ? deps.connectedUsageCeiling(args) : Promise.resolve(null),
        queryTotal: (args) => deps.queryInstantEvalSpendTotal(args),
        toValue: instantEvalMeterUnitsToUsd,
        identifier: instantEvalMeterIdentifier,
      },
    ];
  }

  static getAggregateId(payload: ReportUsageForMonthCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: ReportUsageForMonthCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organizationId": payload.organizationId,
      "payload.billingMonth": payload.billingMonth,
    };
  }

  async handle(command: Command<ReportUsageForMonthCommandData>): Promise<Event[]> {
    const { organizationId, billingMonth, tenantId } = command.data;

    // Assigned on every path that reaches the dispatch below: the catch
    // returns, so there is no third outcome to default to.
    let shouldSelfDispatch: boolean;
    try {
      // 1. Skip conditions
      let lookup = await this.deps.organizationCache.find(organizationId);
      if (!lookup) {
        lookup = await this.deps.organizations.getOrganizationForBilling(organizationId);
        // The skip verdicts are cached too. Only a hit was cached before, so
        // the organizations that reach this handler and can never do anything
        // here were the only ones paying for the query every time.
        await this.deps.organizationCache.set(organizationId, lookup);
      }

      if (lookup.outcome === "not_found") {
        logger.warn({ organizationId }, "organization not found, skipping");
        return [];
      }

      if (lookup.outcome === "not_usage_billed") {
        // Debug, like the two skips below it: a free or legacy plan reaching
        // here is the system working as designed (dispatch has no view on
        // pricing), so warn would put a permanent, recurring line in front
        // of whoever greps for warnings during an incident.
        logger.debug(
          { organizationId },
          "organization is not on usage-based pricing, skipping usage reporting",
        );
        return [];
      }

      const org = lookup.organization;

      if (!org.stripeCustomerId) {
        logger.debug({ organizationId }, "no Stripe customer ID, skipping usage reporting");
        return [];
      }

      if (org.subscriptions.length === 0) {
        logger.debug({ organizationId }, "no active subscription, skipping usage reporting");
        return [];
      }

      // 2. Report for billing month, one meter after the other. A meter that
      // fails does not stop the next: each keeps its own checkpoint and its
      // own breaker.
      shouldSelfDispatch = false;
      for (const meter of this.meters) {
        shouldSelfDispatch =
          (await this.reportOneMeter({
            meter,
            organizationId,
            billingMonth,
            stripeCustomerId: org.stripeCustomerId,
            contract: org.contract,
          })) || shouldSelfDispatch;
      }
    } catch (error) {
      // Never propagate to framework — log and return empty events
      logger.error(
        { organizationId, billingMonth, error },
        "unexpected error in usage reporting command handler",
      );
      this.deps.errorReporter.capture(toError(error), {
        handler: "reportUsageForMonth",
        organizationId,
        billingMonth,
      });
      return [];
    }

    // 3. Self-dispatch for convergence loop (outside try/catch so failures propagate)
    if (shouldSelfDispatch) {
      await this.deps.selfDispatch({
        organizationId,
        billingMonth,
        tenantId,
        occurredAt: nowInstant().epochMilliseconds,
      });
    }

    return [];
  }

  /**
   * One meter's report, with its failure kept to itself: a throw here would
   * otherwise skip every meter after it, with no self-dispatch to come back.
   * Answers whether another tick is owed, which a failure always is.
   */
  private async reportOneMeter(input: {
    meter: BillingMeter;
    organizationId: string;
    billingMonth: string;
    stripeCustomerId: string;
    contract: UsageBillingContract;
  }): Promise<boolean> {
    try {
      return await this.reportForBillingMonth(input);
    } catch (error) {
      logger.error(
        {
          organizationId: input.organizationId,
          billingMonth: input.billingMonth,
          meter: input.meter.eventName,
          error,
        },
        "usage reporting failed for one meter, continuing with the rest",
      );
      this.deps.errorReporter.capture(toError(error), {
        handler: "reportUsageForMonth",
        organizationId: input.organizationId,
        billingMonth: input.billingMonth,
        meter: input.meter.eventName,
      });

      return true;
    }
  }

  /**
   * Two-phase checkpoint, for one meter: writes `pendingReportedTotal` before
   * calling Stripe (intent), then on success promotes it to
   * `lastReportedTotal`. Returns true when self-dispatch should fire.
   */
  private async reportForBillingMonth({
    meter,
    organizationId,
    billingMonth,
    stripeCustomerId,
    contract,
  }: {
    meter: BillingMeter;
    organizationId: string;
    billingMonth: string;
    stripeCustomerId: string;
    contract: UsageBillingContract;
  }): Promise<boolean> {
    const checkpoint = await this.deps.billingCheckpoints.findCheckpoint({
      organizationId,
      billingMonth,
      meter: meter.eventName,
    });

    const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;
    const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;

    // Circuit-breaker: stop self-dispatch after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error(
        {
          organizationId,
          billingMonth,
          consecutiveFailures,
        },
        "ALARM: circuit-breaker tripped — consecutive failures exceeded threshold, " +
          "stopping self-dispatch. Manual investigation required.",
      );
      return false;
    }

    let targetTotal: number;

    if (checkpoint?.pendingReportedTotal != null) {
      // Crash recovery: a previous run wrote the intent but never confirmed.
      targetTotal = checkpoint.pendingReportedTotal;
      logger.info(
        { organizationId, billingMonth, targetTotal, lastReportedTotal },
        "recovering pending checkpoint from previous crash",
      );
    } else {
      // Normal path: query ClickHouse for deduplicated count.
      const totalResult = await meter.queryTotal({ organizationId, billingMonth });

      if (totalResult.outcome === "unavailable") {
        // ClickHouse not available
        return false;
      }

      const currentTotal = totalWithinContractCeiling({
        measured: totalResult.total,
        ceiling: await meter.ceiling({ organizationId, billingMonth, contract }),
        organizationId,
        billingMonth,
        meter,
      });

      if (currentTotal <= lastReportedTotal) {
        logger.debug(
          {
            organizationId,
            billingMonth,
            currentTotal,
            lastReportedTotal,
          },
          "no new billable events, skipping",
        );
        return false;
      }

      targetTotal = currentTotal;

      // Phase 1: Write intent (pendingReportedTotal) before calling Stripe.
      await this.deps.billingCheckpoints.writeIntent({
        organizationId,
        billingMonth,
        meter: meter.eventName,
        lastReportedTotal,
        pendingReportedTotal: targetTotal,
      });
    }

    // Compute delta and report to Stripe
    const delta = targetTotal - lastReportedTotal;
    if (delta <= 0) {
      logger.debug(
        { organizationId, billingMonth, targetTotal, lastReportedTotal },
        "non-positive delta, skipping Stripe report",
      );
      return false;
    }

    const identifier = meter.identifier({
      organizationId,
      billingMonth,
      lastReportedTotal,
      targetTotal,
    });

    const usageReportingService = this.deps.getUsageReportingService();
    if (!usageReportingService) {
      logger.error(
        { organizationId, billingMonth },
        "usageReportingService not available — billing requires isSaas, this is a configuration error",
      );
      return false;
    }

    try {
      const results = await usageReportingService.reportUsageDelta({
        stripeCustomerId,
        organizationId,
        events: [
          {
            eventName: meter.eventName,
            identifier,
            timestamp: meterTimestampFor({
              contract,
              billingMonth,
              nowMs: nowInstant().epochMilliseconds,
            }),
            value: meter.toValue(delta),
          },
        ],
      });

      const result = results[0];

      if (!result?.reported) {
        // Permanent Stripe rejection: do NOT update checkpoint.
        logger.error(
          {
            organizationId,
            billingMonth,
            identifier,
            delta,
            error: result?.error,
          },
          "Stripe permanently rejected meter event, checkpoint NOT updated",
        );
        this.deps.errorReporter.capture(
          new Error(`Stripe rejected meter event: ${result?.error ?? "unknown"}`),
          {
            handler: "reportUsageForMonth",
            organizationId,
            identifier,
            delta,
            stripeError: result?.error,
          },
        );

        // Clear pending so subsequent runs don't replay the rejected delta forever.
        await this.deps.billingCheckpoints.clearPendingAndIncrementFailures({
          organizationId,
          billingMonth,
          meter: meter.eventName,
          consecutiveFailures: consecutiveFailures + 1,
        });

        return false;
      }

      // Phase 2: Confirm checkpoint - promote to lastReportedTotal, clear pending, reset failures.
      await this.deps.billingCheckpoints.confirm({
        organizationId,
        billingMonth,
        meter: meter.eventName,
        lastReportedTotal: targetTotal,
      });

      logger.debug(
        {
          organizationId,
          billingMonth,
          identifier,
          delta,
          targetTotal,
        },
        "usage reported and checkpoint updated successfully",
      );

      return true;
    } catch (error) {
      // Transient error (Stripe rate limit, network, etc.)
      // Increment consecutive failures, but allow self-dispatch for convergence
      logger.warn(
        { organizationId, billingMonth, error },
        "transient error reporting usage to Stripe, will retry via self-dispatch",
      );

      await this.deps.billingCheckpoints.incrementFailures({
        organizationId,
        billingMonth,
        meter: meter.eventName,
        lastReportedTotal,
        pendingReportedTotal: targetTotal,
        consecutiveFailures: consecutiveFailures + 1,
      });

      return true;
    }
  }
}

import { createLogger } from "@langwatch/observability";
import { TtlCache } from "~/server/utils/ttlCache";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import {
  billingMonthDateRange,
  type queryBillableEventsTotal as QueryBillableEventsTotalFn,
} from "../../../../../../ee/billing/services/billableEventsQuery";
import {
  instantEvalMeterUnitsToUsd,
  type queryInstantEvalSpendTotal as QueryInstantEvalSpendTotalFn,
} from "../../../../../../ee/billing/services/instantEvalSpendQuery";
import { meterEventTimestampSeconds } from "../../../../../../ee/billing/services/meterEventTimestamp";
import type { UsageReportingService } from "../../../../../../ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "../../../../app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "../../../../app-layer/organizations/organization.service";
import type {
  BillingOrganizationLookup,
  UsageBillingContract,
} from "../../../../app-layer/organizations/repositories/organization.repository";
import type { Command, CommandHandler } from "../../../";
import { defineCommandSchema } from "../../../";
import type { Event } from "../../../domain/types";
import type { ReportUsageForMonthCommandData } from "../schemas/commands";
import { reportUsageForMonthCommandDataSchema } from "../schemas/commands";
import { BILLING_REPORT_COMMAND_TYPES } from "../schemas/constants";

const logger = createLogger(
  "langwatch:billing-reporting:report-usage-for-month",
);

/** Stripe meter event name for billable events. */
export const BILLABLE_EVENTS_EVENT_NAME = "langwatch_billable_events";

/** Stripe meter event name for Instant Evals, in dollars to four places. */
export const INSTANT_EVAL_USD_EVENT_NAME = "langwatch_instant_eval_usd";

/** Maximum consecutive failures before circuit-breaker trips. */
const MAX_CONSECUTIVE_FAILURES = 5;

const ONE_MINUTE_MS = 60 * 1000;

/**
 * The whole lookup verdict is cached, not just a hit, so a skip costs the same
 * as anything else on a second pass within the window.
 *
 * Worth knowing what this does and does not buy: the window is one minute and
 * the dispatch that drives this handler is suppressed to one per organization
 * per five (`BILLING_METER_DISPATCH_SUPPRESS_MS`), so in the steady state the
 * entry has always expired before the next command arrives and the query runs
 * regardless. What it saves is the bursts, where two commands for one
 * organization land together: the grace window at the start of a month
 * dispatches the previous month alongside the current one, and those carry
 * different dedup keys, so both run.
 */
const orgCache = new TtlCache<BillingOrganizationLookup>(
  ONE_MINUTE_MS,
  "ttlcache:billing:orgData:",
);

export interface ReportUsageForMonthCommandDeps {
  organizations: OrganizationService;
  billingCheckpoints: BillingCheckpointService;
  getUsageReportingService: () => UsageReportingService | undefined;
  queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  queryInstantEvalSpendTotal: typeof QueryInstantEvalSpendTotalFn;
  /**
   * Whether Stripe has a meter for the Instant Evals event name in this mode.
   *
   * Stripe accepts a meter event whose name matches no meter with a 200 and
   * drops it asynchronously, so a report sent before the meter exists would
   * advance the checkpoint past usage that was never aggregated. Until the
   * catalog maps a meter id, the month's total stays in ClickHouse and the
   * first tick after the mapping lands reports it whole.
   */
  isInstantEvalMeterProvisioned: () => boolean;
  /**
   * The most hosted usage a connected customer's month may report, in meter
   * units, or null when nothing caps it (a Cloud customer, or a contract that
   * could not be read).
   *
   * The gateway stops a connected customer at its budget on a 60 second
   * refresh, so the spend ledger can run a few cents past the prepaid commit
   * before it does. That overshoot must never reach the quarterly invoice as
   * an amount due: the credit grant covers exactly the commit, and with
   * overage off there is nothing agreed beyond it. What is reported is
   * clamped at the commit, or at the commit plus the overage maximum when
   * overage is on, less what the term's earlier months already reported.
   */
  connectedUsageCeiling: (input: {
    organizationId: string;
    billingMonth: string;
  }) => Promise<number | null>;
  selfDispatch: (data: ReportUsageForMonthCommandData) => Promise<void>;
}

const SCHEMA = defineCommandSchema(
  BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
  reportUsageForMonthCommandDataSchema,
  "Command to report usage for a billing month to Stripe",
);

/**
 * One meter the month is reported on.
 *
 * Each meter keeps its own checkpoint and its own unit: the events meter
 * counts, the Instant Evals meter holds ten-thousandths of a dollar. What is
 * shared is the protocol around them, which is why the handler runs the same
 * two-phase routine per meter instead of once with two totals.
 */
interface BillingMeter {
  readonly eventName: string;
  /** Whether Stripe holds a meter under this name, so an event sent is aggregated. */
  readonly isProvisioned: () => boolean;
  /** The most the month may report for a capped contract, or null for no cap. */
  ceiling: (args: {
    organizationId: string;
    billingMonth: string;
    contract: UsageBillingContract | undefined;
  }) => Promise<number | null>;
  /** The month's running total in the meter's own integer unit. */
  readonly queryTotal: (args: {
    organizationId: string;
    billingMonth: string;
  }) => Promise<number | null>;
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
  const [, end] = billingMonthDateRange(billingMonth);
  return Date.parse(`${end.replace(" ", "T")}Z`);
}

/**
 * The timestamp the month's meter event carries.
 *
 * A Cloud customer is invoiced monthly, so dating an event inside a month
 * whose invoice may already be finalized would put the amount behind a closed
 * period. Its events therefore stay at the time of reporting, which is what
 * they have always done. A connected customer is invoiced quarterly (ADR-141,
 * section 7), so the month it belongs to is still open and the event is dated
 * there, subject to the meter's own 35-day floor.
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
    periodEndMs:
      contract === "connected" ? billingMonthEndMs(billingMonth) : nowMs,
    nowMs,
  });
}

function instantEvalIdentifier({
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
  return `${organizationId}:${billingMonth}:${INSTANT_EVAL_USD_EVENT_NAME}:from:${lastReportedTotal}:to:${targetTotal}`;
}

/**
 * Command handler for reporting usage to Stripe.
 *
 * The handler:
 * 1. Checks skip conditions (org exists, has Stripe customer, active subscription, SEAT_EVENT pricing)
 * 2. Per meter, two-phase checkpoint protocol: write pending -> call Stripe -> confirm
 * 3. Self-dispatches when any meter's delta > 0 for convergence loop
 * 4. Circuit-breaker on consecutive failures (stops self-dispatch after MAX_CONSECUTIVE_FAILURES)
 *
 * Error handling: never propagates to framework. All errors caught internally.
 * The framework sees every job as "successful" — the handler owns all retry logic.
 *
 * Uses constructor DI — instantiate with deps and pass via `.withCommandInstance()`.
 */
export class ReportUsageForMonthCommand
  implements CommandHandler<Command<ReportUsageForMonthCommandData>, Event>
{
  static readonly schema = SCHEMA;

  private readonly meters: readonly BillingMeter[];

  constructor(private readonly deps: ReportUsageForMonthCommandDeps) {
    this.meters = [
      {
        eventName: BILLABLE_EVENTS_EVENT_NAME,
        // The events meter predates the catalog check and every mode maps it.
        isProvisioned: () => true,
        ceiling: async () => null,
        queryTotal: (args) => deps.queryBillableEventsTotal(args),
        toValue: (delta) => delta,
        identifier: billableEventsIdentifier,
      },
      {
        eventName: INSTANT_EVAL_USD_EVENT_NAME,
        isProvisioned: deps.isInstantEvalMeterProvisioned,
        ceiling: ({ contract, ...args }) =>
          contract === "connected"
            ? deps.connectedUsageCeiling(args)
            : Promise.resolve(null),
        queryTotal: (args) => deps.queryInstantEvalSpendTotal(args),
        toValue: instantEvalMeterUnitsToUsd,
        identifier: instantEvalIdentifier,
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

  async handle(
    command: Command<ReportUsageForMonthCommandData>,
  ): Promise<Event[]> {
    const { organizationId, billingMonth, tenantId } = command.data;

    let shouldSelfDispatch = false;
    try {
      // 1. Skip conditions
      let lookup = await orgCache.get(organizationId);
      if (!lookup) {
        lookup =
          await this.deps.organizations.getOrganizationForBilling(
            organizationId,
          );
        // The skip verdicts are cached too. Only a hit was cached before, so
        // the organizations that reach this handler and can never do anything
        // here were the only ones paying for the query every time.
        await orgCache.set(organizationId, lookup);
      }

      if (lookup.outcome === "not_found") {
        logger.warn({ organizationId }, "organization not found, skipping");
        return [];
      }

      if (lookup.outcome === "not_usage_billed") {
        // Debug, like the two skips below it. A free or legacy plan reaching
        // this handler is the system working: the dispatch is per active
        // organization and takes no view on pricing, so every one of them
        // arrives here and stops. Reporting that at warn put a permanent,
        // recurring line in front of whoever greps for warnings during an
        // incident.
        logger.debug(
          { organizationId },
          "organization is not on usage-based pricing, skipping usage reporting",
        );
        return [];
      }

      const org = lookup.organization;

      if (!org.stripeCustomerId) {
        logger.debug(
          { organizationId },
          "no Stripe customer ID, skipping usage reporting",
        );
        return [];
      }

      if (org.subscriptions.length === 0) {
        logger.debug(
          { organizationId },
          "no active subscription, skipping usage reporting",
        );
        return [];
      }

      // 2. Report for billing month, one meter after the other. A meter that
      // fails does not stop the next: each keeps its own checkpoint and its
      // own breaker, and the events meter is not made late by a Stripe
      // rejection on the Instant Evals one.
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
      await withScope(async (scope) => {
        scope.setTag?.("handler", "reportUsageForMonth");
        scope.setExtra?.("organizationId", organizationId);
        scope.setExtra?.("billingMonth", billingMonth);
        captureException(toError(error));
      });
      return [];
    }

    // 3. Self-dispatch for convergence loop (outside try/catch so failures propagate)
    if (shouldSelfDispatch) {
      await this.deps.selfDispatch({
        organizationId,
        billingMonth,
        tenantId,
        occurredAt: Date.now(),
      });
    }

    return [];
  }

  /**
   * One meter's report, with its failure kept to itself.
   *
   * Its own method rather than a try inside the loop because a throw from one
   * meter's checkpoint read, total query or intent write would otherwise skip
   * every meter after it, and the skipped ones get no self-dispatch either, so
   * their usage waits for the next tick with nothing recording that it was
   * missed. Answers whether another tick is owed, which a failure always is.
   */
  private async reportOneMeter({
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
    try {
      return await this.reportForBillingMonth({
        meter,
        organizationId,
        billingMonth,
        stripeCustomerId,
        contract,
      });
    } catch (error) {
      logger.error(
        { organizationId, billingMonth, meter: meter.eventName, error },
        "usage reporting failed for one meter, continuing with the rest",
      );
      await withScope(async (scope) => {
        scope.setTag?.("handler", "reportUsageForMonth");
        scope.setTag?.("meter", meter.eventName);
        scope.setExtra?.("organizationId", organizationId);
        scope.setExtra?.("billingMonth", billingMonth);
        captureException(toError(error));
      });
      return true;
    }
  }

  /**
   * Two-phase checkpoint protocol, for one meter:
   * 1. Write `pendingReportedTotal` before calling Stripe (intent).
   * 2. On success, promote to `lastReportedTotal` and clear pending.
   *
   * Returns true if self-dispatch should fire (delta was reported successfully).
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
    if (!meter.isProvisioned()) {
      // Nothing is read or written: the checkpoint stays where it is, so the
      // whole month is reported by the first tick after the meter is mapped.
      logger.debug(
        { organizationId, billingMonth, meter: meter.eventName },
        "Stripe meter is not mapped for this mode; leaving the month's usage unreported until it is",
      );
      return false;
    }
    const key = { organizationId, billingMonth, meter: meter.eventName };
    const checkpoint = await this.deps.billingCheckpoints.getCheckpoint(key);

    const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;
    const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;

    // Circuit-breaker: stop self-dispatch after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error(
        {
          organizationId,
          billingMonth,
          meter: meter.eventName,
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
        {
          organizationId,
          billingMonth,
          meter: meter.eventName,
          targetTotal,
          lastReportedTotal,
        },
        "recovering pending checkpoint from previous crash",
      );
    } else {
      // Normal path: query ClickHouse for the month's total.
      const measured = await meter.queryTotal({
        organizationId,
        billingMonth,
      });

      if (measured === null) {
        // ClickHouse not available
        return false;
      }

      const ceiling = await meter.ceiling({
        organizationId,
        billingMonth,
        contract,
      });
      const currentTotal =
        ceiling !== null && measured > ceiling ? ceiling : measured;
      if (currentTotal !== measured) {
        logger.info(
          {
            organizationId,
            billingMonth,
            meter: meter.eventName,
            measured,
            ceiling,
          },
          "hosted usage ran past the contract ceiling; reporting the ceiling",
        );
      }

      if (currentTotal <= lastReportedTotal) {
        logger.debug(
          {
            organizationId,
            billingMonth,
            meter: meter.eventName,
            currentTotal,
            lastReportedTotal,
          },
          "no new usage on this meter, skipping",
        );
        return false;
      }

      targetTotal = currentTotal;

      // Phase 1: Write intent (pendingReportedTotal) before calling Stripe.
      await this.deps.billingCheckpoints.writeIntent({
        ...key,
        lastReportedTotal,
        pendingReportedTotal: targetTotal,
      });
    }

    // Compute delta and report to Stripe
    const delta = targetTotal - lastReportedTotal;
    if (delta <= 0) {
      logger.debug(
        {
          organizationId,
          billingMonth,
          meter: meter.eventName,
          targetTotal,
          lastReportedTotal,
        },
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
              nowMs: Date.now(),
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
            meter: meter.eventName,
            identifier,
            delta,
            error: result?.error,
          },
          "Stripe permanently rejected meter event, checkpoint NOT updated",
        );
        await withScope(async (scope) => {
          scope.setTag?.("handler", "reportUsageForMonth");
          scope.setExtra?.("organizationId", organizationId);
          scope.setExtra?.("identifier", identifier);
          scope.setExtra?.("delta", delta);
          scope.setExtra?.("stripeError", result?.error);
          captureException(
            new Error(
              `Stripe rejected meter event: ${result?.error ?? "unknown"}`,
            ),
          );
        });

        // Clear pending so subsequent runs don't replay the rejected delta forever.
        await this.deps.billingCheckpoints.clearPendingAndIncrementFailures({
          ...key,
          consecutiveFailures: consecutiveFailures + 1,
        });

        return false;
      }

      // Phase 2: Confirm checkpoint - promote to lastReportedTotal, clear pending, reset failures.
      await this.deps.billingCheckpoints.confirm({
        ...key,
        lastReportedTotal: targetTotal,
      });

      logger.debug(
        {
          organizationId,
          billingMonth,
          meter: meter.eventName,
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
        { organizationId, billingMonth, meter: meter.eventName, error },
        "transient error reporting usage to Stripe, will retry via self-dispatch",
      );

      await this.deps.billingCheckpoints.incrementFailures({
        ...key,
        lastReportedTotal,
        pendingReportedTotal: targetTotal,
        consecutiveFailures: consecutiveFailures + 1,
      });

      return true;
    }
  }
}

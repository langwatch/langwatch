import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "@ee/billing/services/billableEventsQuery";
import { createLogger } from "@langwatch/observability";
import {
  BILLING_GRACE_PERIOD_DAYS,
  BILLING_METER_SWEEP_INTERVAL_MS,
} from "../constants";
import type { ReportUsageForMonthData } from "./reportUsageForMonth";

const logger = createLogger("langwatch:billing-reporting:meter-sweep");

export const BILLING_METER_SWEEP_NAME = "billingMeterSweep" as const;

export interface BillingMeterSweepDeps {
  /**
   * Organizations whose month total must be re-read and reported. Must include
   * every organization that could have unreported usage in that month — one
   * missing from this set is one the safety net cannot rescue. Read per month,
   * because the grace window's candidate set is not the current month's.
   */
  readonly listOrganizationsToReport: (
    params: Pick<ReportUsageForMonthData, "billingMonth">,
  ) => Promise<string[]>;
  /** Bound to the same `reportUsageForMonth` closure the poke uses, so a sweep
   *  dispatch collapses into a pending poke dispatch on the command's own
   *  group key. */
  readonly dispatchReport: (data: ReportUsageForMonthData) => Promise<void>;
  /** Records that this tick ran, exactly once per tick. Deliberately narrow —
   *  no arguments, nothing to persist — so what durable bookkeeping the
   *  scheduler mount needs stays that mount's decision. */
  readonly recordTick: () => Promise<void>;
  readonly now?: () => number;
}

/**
 * Billing months one tick is responsible for: always the current one, plus
 * the previous one while late-arriving events can still land in it — the
 * same grace window the per-event poke applies.
 */
export function billingMonthsForSweep(now: Date): string[] {
  const months = [getBillingMonth(now)];
  if (now.getUTCDate() <= BILLING_GRACE_PERIOD_DAYS) {
    months.push(getPreviousBillingMonth(now));
  }
  return months;
}

/**
 * The scheduled sweep (ADR-098): the durability guarantee behind the poke. It
 * wakes on `BILLING_METER_SWEEP_INTERVAL_MS`, reads the two months it owes, and
 * dispatches a report for every candidate organization regardless of whether
 * any billable event has occurred since the last run.
 */
export function runBillingMeterSweep(deps: BillingMeterSweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const months = billingMonthsForSweep(new Date(startedAt));

    let dispatched = 0;
    const failures: Array<{ organizationId: string; billingMonth: string }> =
      [];
    /** Raised after the loop, first one wins — see the throw at the bottom. */
    const raise: Error[] = [];

    for (const billingMonth of months) {
      // Each month is attempted independently. A candidate-store blip while
      // listing the CURRENT month must not abort the tick before the
      // PREVIOUS one is tried: the grace window is only a few days wide, and
      // it is the window in which a month that has stopped receiving events
      // gets closed out. Losing it to a listing failure loses that month's
      // tail for good.
      let organizationIds: string[];
      try {
        organizationIds = await deps.listOrganizationsToReport({
          billingMonth,
        });
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        raise.push(failure);
        logger.error(
          { billingMonth, error: failure.message },
          "billing meter sweep could not list the organizations to report; this month is skipped for this tick and retried with it",
        );
        continue;
      }

      for (const organizationId of organizationIds) {
        try {
          await deps.dispatchReport({
            organizationId,
            billingMonth,
            tenantId: organizationId,
            occurredAt: startedAt,
          });
          dispatched++;
        } catch (error) {
          failures.push({ organizationId, billingMonth });
          logger.error(
            {
              organizationId,
              billingMonth,
              error: error instanceof Error ? error.message : String(error),
            },
            "billing meter sweep could not dispatch a usage report; this organization's usage stays unreported until a later attempt succeeds",
          );
        }
      }
    }

    // Recorded before the failure is raised: this tick happened either way,
    // and a run of failing ticks must not also lose its own bookkeeping.
    try {
      await deps.recordTick();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "billing meter sweep tick bookkeeping failed",
      );
    }

    if (failures.length > 0) {
      raise.push(
        new Error(
          `billing meter sweep failed to dispatch ${failures.length} of ${dispatched + failures.length} usage reports`,
        ),
      );
    }

    // Raised, not logged-and-forgotten: whatever schedules this tick must
    // retry the whole thing, and re-dispatching organizations that already
    // succeeded is free — the command reads the month total as a level and
    // its Stripe identifier is derived from that level, so a repeat is a
    // no-op rather than a double charge. The first failure is the one
    // raised; the rest are already logged above.
    const [firstFailure] = raise;
    if (firstFailure) {
      throw firstFailure;
    }

    logger.debug(
      { months, dispatched },
      "billing meter sweep dispatched usage reports",
    );
  };
}

/** How the sweep is mounted: run `run()` every `intervalMs`, retry a thrown
 *  tick. `~/server/app-layer/scheduler/scheduler.service.ts` already gives
 *  exactly that to unrelated recurring jobs. */
export interface BillingMeterSweepMount {
  readonly name: typeof BILLING_METER_SWEEP_NAME;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export function createBillingMeterSweepMount(
  deps: BillingMeterSweepDeps,
): BillingMeterSweepMount {
  return {
    name: BILLING_METER_SWEEP_NAME,
    intervalMs: BILLING_METER_SWEEP_INTERVAL_MS,
    run: runBillingMeterSweep(deps),
  };
}

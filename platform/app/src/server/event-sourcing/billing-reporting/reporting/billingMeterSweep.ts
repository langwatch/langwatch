import { createLogger } from "@langwatch/observability";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "@ee/billing/services/billableEventsQuery";
import { BILLING_GRACE_PERIOD_DAYS, BILLING_METER_SWEEP_INTERVAL_MS } from "../constants";
import type { ReportUsageForMonthData } from "./reportUsageForMonth";

const logger = createLogger("langwatch:billing-reporting:meter-sweep");

export const BILLING_METER_SWEEP_NAME = "billingMeterSweep" as const;

export interface BillingMeterSweepDeps {
  /**
   * Organizations whose month total must be re-read and reported. Must
   * include every organization that could have unreported usage in that
   * month — an organization missing from this set is one the safety net
   * cannot rescue. Read per month rather than once, because the grace window
   * sweeps the previous month too and its candidate set is not the current
   * month's.
   *
   * Unchanged by this rewrite: `~/server/app-layer/billing/
   * billingReportingCandidates.service.ts`, outside this pipeline's
   * directory, already satisfies this contract and already carries its own
   * `@scenario "The organizations to report are every one that could owe usage"`
   * binding.
   */
  readonly listOrganizationsToReport: (
    params: Pick<ReportUsageForMonthData, "billingMonth">,
  ) => Promise<string[]>;
  /**
   * Dispatches the reporting command. Wired to the same function the poke
   * uses (`index.ts` binds both to one `reportUsageForMonth` closure), so a
   * sweep dispatch collapses into a pending poke dispatch through the
   * command's own group-key deduplication (`dispatchOptions.ts`'s
   * `reportUsageForMonthGroupKey`) once a real dispatcher exists.
   */
  readonly dispatchReport: (data: ReportUsageForMonthData) => Promise<void>;
  /**
   * Records that this tick ran, exactly once per tick.
   *
   * KNOWN GAP: the pre-rewrite sweep ran as a durable process-manager intent
   * (`event-sourcing.old`'s `withProcessManager`), whose outbox gave it
   * at-least-once delivery independent of this pipeline's own code — a crash
   * mid-tick left an intent row for the outbox to retry, not a lost tick. No
   * process-manager or outbox primitive exists in `@langwatch/event-sourcing`
   * yet (only `defineAggregate`, the fold/map executors and the store
   * contracts are exported — see `index.ts`'s docblock), so this rewrite
   * cannot faithfully reproduce that durability property; it can only
   * guarantee the property this task calls out explicitly — that the sweep
   * runs *on a schedule*, never depending on an event arriving. `recordTick`
   * is deliberately narrow (no arguments, no return value to persist) so
   * whatever durable bookkeeping the eventual scheduler mount needs is that
   * mount's decision, not this function's.
   */
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
 * The scheduled sweep (ADR-098): the durability guarantee behind the
 * per-event poke. It is a SCHEDULED guarantee, not a per-event one — it wakes
 * on `BILLING_METER_SWEEP_INTERVAL_MS`, reads the two months it owes, and
 * dispatches a report for every candidate organization, regardless of
 * whether any billable event has occurred since the last run. It exists only
 * for the two cases the poke structurally cannot cover: a poke whose
 * dispatch failed every retry, and an organization whose last billable event
 * of the month is its last event ever (nothing pokes again, so nothing
 * re-reads the total).
 */
export function runBillingMeterSweep(deps: BillingMeterSweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const months = billingMonthsForSweep(new Date(startedAt));

    let dispatched = 0;
    const failures: Array<{ organizationId: string; billingMonth: string }> = [];
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
        organizationIds = await deps.listOrganizationsToReport({ billingMonth });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
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

    logger.debug({ months, dispatched }, "billing meter sweep dispatched usage reports");
  };
}

/**
 * Describes how the sweep must be mounted, for a future scheduler — no
 * process-manager/scheduler runtime exists in `@langwatch/event-sourcing`
 * yet (see `index.ts`'s docblock), so this stays a plain descriptor. The
 * pre-existing, generic `~/server/app-layer/scheduler/scheduler.service.ts`
 * (outside this pipeline's directory, not wired here) is the most likely home
 * for it: it already gives at-least-once, claim-based execution to
 * unrelated recurring jobs, which is exactly the shape "runs `run()` every
 * `intervalMs`, retries a thrown tick" needs.
 */
export interface BillingMeterSweepMount {
  readonly name: typeof BILLING_METER_SWEEP_NAME;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export function createBillingMeterSweepMount(deps: BillingMeterSweepDeps): BillingMeterSweepMount {
  return {
    name: BILLING_METER_SWEEP_NAME,
    intervalMs: BILLING_METER_SWEEP_INTERVAL_MS,
    run: runBillingMeterSweep(deps),
  };
}

import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "../../../../../../ee/billing/services/billableEventsQuery";
import type { ReportUsageForMonthCommandData } from "../schemas/commands";
import { BILLING_GRACE_PERIOD_DAYS } from "../schemas/constants";

const logger = createLogger("langwatch:billing-reporting:meter-sweep");

export const BILLING_METER_SWEEP_PROCESS_NAME = "billingMeterSweep" as const;

/**
 * Hourly.
 *
 * The per-event poke is the fast path and already collapses to one dispatch
 * per project per five minutes, so this sweep exists only for the cases the
 * poke structurally cannot cover: a poke whose dispatch failed every retry,
 * and an organization whose last billable event of the month is its last event
 * ever (nothing pokes again, so nothing re-reads the total).
 *
 * Neither case is urgent — usage is invoiced monthly and the meter value is a
 * level read of the month total, so a report an hour late costs nothing and a
 * report that never happens costs the whole month. Hourly buys recovery well
 * inside the billing period while keeping the cost bounded: one ClickHouse
 * level read per billable organization per hour, and no Stripe call at all
 * unless the delta is positive.
 */
export const BILLING_METER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * One bookkeeping outbox row per tick, pruned on the same schedule every other
 * recurring process uses.
 */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const billingMeterSweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface BillingMeterSweepState {
  lastSweepAt: number | null;
}

export interface BillingMeterSweepDeps {
  /**
   * Organizations whose month total must be re-read and reported.
   *
   * Read per month rather than once, because the grace window sweeps the
   * previous month too and its candidate set is not the current month's.
   */
  listOrganizationsToReport: (params: {
    billingMonth: string;
  }) => Promise<string[]>;
  /**
   * Dispatches the reporting command. Wired to the same command port the
   * per-event poke uses, so a sweep dispatch collapses into a pending poke
   * dispatch through the command's own `${organizationId}:${billingMonth}`
   * deduplication — the sweep costs nothing extra while the poke path is
   * healthy.
   */
  dispatchReport: (data: ReportUsageForMonthCommandData) => Promise<void>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type BillingMeterSweepIntents = {
  sweep: IntentSpec<typeof billingMeterSweepSchema>;
};

/**
 * Wake handlers must be pure and synchronous — no I/O, no clock reads —
 * because the commit that persists this evolution is what fences racing
 * workers. The sweep itself is an intent, so it runs behind the outbox lease.
 */
export const billingMeterSweepWake: WakeHandler<
  BillingMeterSweepState,
  BillingMeterSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/**
 * Billing months this tick is responsible for: always the current one, plus
 * the previous one while late-arriving events can still land in it — the same
 * grace window the per-event poke applies.
 */
export function billingMonthsForSweep(now: Date): string[] {
  const months = [getBillingMonth(now)];
  if (now.getUTCDate() <= BILLING_GRACE_PERIOD_DAYS) {
    months.push(getPreviousBillingMonth(now));
  }
  return months;
}

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
      // Each month is attempted independently, exactly as the per-event poke
      // does it. A candidate-store blip while listing the CURRENT month must
      // not abort the tick before the PREVIOUS one is tried: the grace window
      // is only a few days wide, and it is the window in which a month that
      // has stopped receiving events gets closed out. Losing it to repeated
      // listing failures loses that month's tail for good.
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
          "Billing meter sweep could not list the organizations to report; this month is skipped for this tick and retried with it",
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
            "Billing meter sweep could not dispatch a usage report; this organization's usage stays unreported until a later attempt succeeds",
          );
        }
      }
    }

    // Retention runs before the failure is raised: the rows this tick wrote are
    // bookkeeping either way, and a run of failing ticks must not let them
    // accumulate.
    try {
      await deps.deleteDispatchedBefore({
        processName: BILLING_METER_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Billing meter sweep outbox retention failed",
      );
    }

    if (failures.length > 0) {
      raise.push(
        new Error(
          `Billing meter sweep failed to dispatch ${failures.length} of ${
            dispatched + failures.length
          } usage reports`,
        ),
      );
    }

    // Raised, not logged-and-forgotten: the outbox retries the whole tick, and
    // re-dispatching the organizations that already succeeded is free — the
    // command reads the month total as a level and its Stripe identifier is
    // derived from that level, so a repeat is a no-op rather than a double
    // charge. The first failure is the one raised; the rest are already logged
    // above, and one throw is all the outbox needs to retry everything.
    const [firstFailure] = raise;
    if (firstFailure) {
      throw firstFailure;
    }

    logger.debug(
      { months, dispatched },
      "Billing meter sweep dispatched usage reports",
    );
  };
}

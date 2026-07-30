import { getBillingMonth, getPreviousBillingMonth } from "@ee/billing/services/billableEventsQuery";
import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { BILLING_GRACE_PERIOD_DAYS } from "./billingMeterPoke.process";
import { billingReportingEvents } from "./events";
import { type ReportUsagePorts, reportUsage } from "./reportUsage";

const logger = createLogger("langwatch:billing-reporting:meter-sweep");

export const BILLING_METER_SWEEP_PROCESS_NAME = "billingMeterSweep" as const;

/** Hourly: the durability guarantee behind the per-event poke. */
export const BILLING_METER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** This process wakes hourly, so its own dispatched outbox rows are kept a
 *  week. */
const SWEEP_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const billingMeterSweepStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
  /** The scheduler is external to this state (ADR-105 §12): nothing here
   *  arms the very first wake, but every wake after that re-arms itself, and
   *  a `billableEventRecorded` event this global singleton does not act on
   *  must leave whatever is currently armed untouched. */
  nextWakeAt: z.number().nullable(),
});
export type BillingMeterSweepState = z.infer<typeof billingMeterSweepStateSchema>;

export function initBillingMeterSweepState(): BillingMeterSweepState {
  return { lastSweepAt: null, nextWakeAt: null };
}

export const sweepPayloadSchema = z.object({ scheduledFor: z.number().int() });
export type SweepPayload = z.infer<typeof sweepPayloadSchema>;

export interface BillingMeterSweepPorts extends ReportUsagePorts {
  /**
   * Organizations whose month total must be re-read and reported. Must
   * include every organization that could have unreported usage in that
   * month — one missing from this set is one the safety net cannot rescue.
   * Read per month, because the grace window's candidate set is not the
   * current month's.
   */
  readonly listOrganizationsToReport: (params: { billingMonth: string }) => Promise<string[]>;
  /** Deletes this process's own dispatched outbox rows older than `before`. */
  readonly pruneDispatchedIntentsBefore: (params: { before: number }) => Promise<number>;
}

/** Billing months one tick is responsible for: always the current one, plus
 *  the previous one while late-arriving events can still land in it — the
 *  same grace window the per-event poke applies. */
export function billingMonthsForSweep(now: Date): string[] {
  const months = [getBillingMonth(now)];
  if (now.getUTCDate() <= BILLING_GRACE_PERIOD_DAYS) {
    months.push(getPreviousBillingMonth(now));
  }
  return months;
}

/**
 * The scheduled sweep (ADR-098): the durability guarantee behind the poke. It
 * wakes hourly, reads the months it owes, and dispatches a report for every
 * candidate organization regardless of whether any billable event has
 * occurred since the last run. Each month is attempted independently, so a
 * listing failure for one does not skip the other; any dispatch failure is
 * raised after every organization has been attempted, so the outbox retries
 * the whole tick — re-dispatching an organization that already succeeded is
 * free, because the report reads the month total as a level.
 */
function createSweepIntent(ports: BillingMeterSweepPorts): IntentDef<typeof sweepPayloadSchema> {
  return {
    payload: sweepPayloadSchema,
    messageKey: (payload) => `sweep:${payload.scheduledFor}`,
    async deliver(payload) {
      const startedAt = payload.scheduledFor;
      const months = billingMonthsForSweep(new Date(startedAt));

      let dispatched = 0;
      const failures: Array<{ organizationId: string; billingMonth: string }> = [];
      const raise: Error[] = [];

      for (const billingMonth of months) {
        let organizationIds: string[];
        try {
          organizationIds = await ports.listOrganizationsToReport({ billingMonth });
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
            await reportUsage(ports, { organizationId, billingMonth, tenantId: organizationId, occurredAt: startedAt });
            dispatched++;
          } catch (error) {
            failures.push({ organizationId, billingMonth });
            logger.error(
              { organizationId, billingMonth, error: error instanceof Error ? error.message : String(error) },
              "billing meter sweep could not report usage; this organization's usage stays unreported until a later attempt succeeds",
            );
          }
        }
      }

      try {
        await ports.pruneDispatchedIntentsBefore({ before: startedAt - SWEEP_OUTBOX_RETENTION_MS });
      } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, "billing meter sweep outbox retention failed");
      }

      if (failures.length > 0) {
        raise.push(new Error(`billing meter sweep failed to report ${failures.length} of ${dispatched + failures.length} usage reports`));
      }
      const [firstFailure] = raise;
      if (firstFailure) throw firstFailure;

      logger.debug({ months, dispatched }, "billing meter sweep dispatched usage reports");
    },
  };
}

export function billingMeterSweepIntents(ports: BillingMeterSweepPorts) {
  return { sweep: createSweepIntent(ports) };
}

type BillingMeterSweepIntents = ReturnType<typeof billingMeterSweepIntents>;

/** `billableEventRecorded` carries nothing this global singleton acts on —
 *  see `billingMeterSweepStateSchema.nextWakeAt`'s docblock for why this is a
 *  real no-op rather than a manufactured one. */
export const billingMeterSweepOn: ProcessManagerHandlerMap<
  typeof billingReportingEvents,
  BillingMeterSweepState,
  BillingMeterSweepIntents
> = {
  billableEventRecorded(state): EvolveStep<BillingMeterSweepState, BillingMeterSweepIntents> {
    return { state, intents: [], nextWakeAt: state.nextWakeAt };
  },
};

export function billingMeterSweepOnWake(
  state: BillingMeterSweepState,
  ctx: ProcessContext,
): EvolveStep<BillingMeterSweepState, BillingMeterSweepIntents> {
  const nextWakeAt = ctx.now + BILLING_METER_SWEEP_INTERVAL_MS;
  return {
    state: { lastSweepAt: ctx.now, nextWakeAt },
    intents: [{ type: "sweep", payload: { scheduledFor: ctx.now } }],
    nextWakeAt,
  };
}

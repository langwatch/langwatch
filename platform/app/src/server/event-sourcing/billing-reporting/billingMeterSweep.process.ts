import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "@ee/billing/services/billableEventsQuery";
import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { BILLING_GRACE_PERIOD_DAYS } from "./billingMeterPoke.process";
import type { billingReportingEvents } from "./events";
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
   *  must leave whatever is currently armed untouched.
   *
   *  Defaulted because it is new: a deployed row predates the field and carries
   *  no state version to gate on, so a required key would fail its decode. */
  nextWakeAt: z.number().nullable().default(null),
});
export type BillingMeterSweepState = z.infer<
  typeof billingMeterSweepStateSchema
>;

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
  readonly listOrganizationsToReport: (params: {
    billingMonth: string;
  }) => Promise<string[]>;
  /** Deletes dispatched outbox rows older than `before` for one process. The
   *  name is not optional: the outbox is shared, and other processes keep their
   *  own history for longer than this sweep's week. */
  readonly pruneDispatchedIntentsBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
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
 * The scheduled sweep: the durability guarantee behind the poke. It wakes
 * hourly, reads the months it owes, and reports every candidate organization
 * regardless of whether a billable event has occurred since the last run.
 *
 * Each month is listed independently, so a listing failure for one does not
 * skip the other, and a listing failure is raised so the outbox retries the
 * whole tick — repeating an organization that already succeeded is free,
 * because the report reads the month total as a level. A per-organization
 * reporting failure is NOT raised, because `reportUsage` handles its own: it
 * records the failure on that organization's billing checkpoint and returns,
 * so the delta converges on the next poke or the next tick.
 */
function createSweepIntent(
  ports: BillingMeterSweepPorts,
): IntentDef<typeof sweepPayloadSchema> {
  return {
    payload: sweepPayloadSchema,
    messageKey: (payload) => `sweep:${payload.scheduledFor}`,
    async deliver(payload) {
      const startedAt = payload.scheduledFor;
      const months = billingMonthsForSweep(new Date(startedAt));

      let reported = 0;
      const raise: Error[] = [];

      for (const billingMonth of months) {
        let organizationIds: string[];
        try {
          organizationIds = await ports.listOrganizationsToReport({
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
          await reportUsage(ports, {
            organizationId,
            billingMonth,
            tenantId: organizationId,
            occurredAt: startedAt,
          });
          reported++;
        }
      }

      // Before the raise: these rows are bookkeeping either way, and a run of
      // failing ticks must not let them accumulate.
      try {
        await ports.pruneDispatchedIntentsBefore({
          processName: BILLING_METER_SWEEP_PROCESS_NAME,
          before: startedAt - SWEEP_OUTBOX_RETENTION_MS,
        });
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "billing meter sweep outbox retention failed",
        );
      }

      const [firstFailure] = raise;
      if (firstFailure) throw firstFailure;

      logger.debug(
        { months, reported },
        "billing meter sweep reported usage for every candidate organization",
      );
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
  billableEventRecorded(
    state,
  ): EvolveStep<BillingMeterSweepState, BillingMeterSweepIntents> {
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

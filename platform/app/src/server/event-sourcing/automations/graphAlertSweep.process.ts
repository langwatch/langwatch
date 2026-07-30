import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { automationsEvents } from "./events";

const logger = createLogger("langwatch:automations:graph-alert-sweep");

export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;
/** This process wakes every 30s, so its own dispatched outbox rows are kept a
 *  day — long enough to read back a failed sweep's history without letting the
 *  outbox grow unboundedly. */
const SWEEP_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export const graphAlertSweepStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
  /** The scheduler is external to this state (ADR-105 §12): nothing here
   *  arms the very first wake, but every wake after that re-arms itself, and
   *  a `matchRecorded` event this process does not otherwise act on must
   *  leave whatever is currently armed untouched — the only way to state that
   *  truthfully is to carry the deadline in state and hand it straight back.
   *
   *  Defaulted because it is new: a deployed row predates the field, carries no
   *  state version to gate on, and a required key would fail its decode
   *  instead of reading as "nothing armed yet". */
  nextWakeAt: z.number().nullable().default(null),
});
export type GraphAlertSweepState = z.infer<typeof graphAlertSweepStateSchema>;

export function initGraphAlertSweepState(): GraphAlertSweepState {
  return { lastSweepAt: null, nextWakeAt: null };
}

export const evaluateGraphPayloadSchema = z.object({
  scheduledFor: z.number().int(),
});
export type EvaluateGraphPayload = z.infer<typeof evaluateGraphPayloadSchema>;

/** One tenant's graph trigger, due for a heartbeat evaluation. Shaped so the
 *  composition root can satisfy this and the real-time subscriber's
 *  `evaluateGraphTrigger` with one function. */
export interface GraphAlertSweepCandidate {
  readonly triggerId: string;
  readonly tenantId: string;
  readonly reason: "heartbeat";
}

export interface GraphAlertSweepPorts {
  /** Every graph trigger due for a heartbeat sweep right now. Skipping a tenant
   *  whose real-time path is already firing is this port's decision, not the
   *  pipeline's. */
  decideSweepCandidates(params: {
    now: Date;
  }): Promise<readonly GraphAlertSweepCandidate[]>;
  evaluateGraphTrigger(candidate: GraphAlertSweepCandidate): Promise<void>;
  /** Deletes dispatched outbox rows older than `before` for one process. The
   *  name is not optional: the outbox is shared, and other processes keep their
   *  own history for longer than this sweep's day. */
  pruneDispatchedIntentsBefore(params: {
    processName: string;
    before: number;
  }): Promise<number>;
}

/**
 * A singleton, schedule-only process manager backstopping the real-time
 * graph-trigger subscriber: a "no data" alert fires on the ABSENCE of traces,
 * and a lost real-time job has nothing else to recover it.
 *
 * The key carries the wake instant, so a redelivered WAKE mints a fresh key and
 * sweeps again. That is bounded and harmless — the candidate query and the
 * evaluator are both level reads — but it is a second sweep, not a collapse.
 * One candidate's failure is isolated so a single tenant never stalls the rest.
 */
function createEvaluateGraphIntent(
  ports: GraphAlertSweepPorts,
): IntentDef<typeof evaluateGraphPayloadSchema> {
  return {
    payload: evaluateGraphPayloadSchema,
    messageKey: (payload) => `sweep:${payload.scheduledFor}`,
    async deliver(payload) {
      const candidates = await ports.decideSweepCandidates({
        now: new Date(payload.scheduledFor),
      });
      let failures = 0;
      for (const candidate of candidates) {
        try {
          await ports.evaluateGraphTrigger(candidate);
        } catch (error) {
          failures++;
          logger.error(
            {
              tenantId: candidate.tenantId,
              triggerId: candidate.triggerId,
              reason: candidate.reason,
              error: error instanceof Error ? error.message : String(error),
            },
            "Graph-alert sweep candidate failed; the next sweep retries it",
          );
        }
      }
      if (failures > 0) {
        logger.warn(
          { failures, candidates: candidates.length },
          "Graph-alert sweep completed with isolated candidate failures",
        );
      }

      try {
        await ports.pruneDispatchedIntentsBefore({
          processName: GRAPH_ALERT_SWEEP_PROCESS_NAME,
          before: payload.scheduledFor - SWEEP_OUTBOX_RETENTION_MS,
        });
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "Graph-alert sweep outbox retention failed",
        );
      }
    },
  };
}

export function graphAlertSweepIntents(ports: GraphAlertSweepPorts) {
  return { evaluateGraph: createEvaluateGraphIntent(ports) };
}

type GraphAlertSweepIntents = ReturnType<typeof graphAlertSweepIntents>;

/** `matchRecorded` carries nothing this singleton scheduler acts on — see
 *  `graphAlertSweepStateSchema.nextWakeAt`'s docblock for why this is a real
 *  no-op rather than a manufactured one. */
export const graphAlertSweepOn: ProcessManagerHandlerMap<
  typeof automationsEvents,
  GraphAlertSweepState,
  GraphAlertSweepIntents
> = {
  matchRecorded(
    state,
  ): EvolveStep<GraphAlertSweepState, GraphAlertSweepIntents> {
    return { state, intents: [], nextWakeAt: state.nextWakeAt };
  },
};

export function graphAlertSweepOnWake(
  state: GraphAlertSweepState,
  ctx: ProcessContext,
): EvolveStep<GraphAlertSweepState, GraphAlertSweepIntents> {
  const nextWakeAt = ctx.now + GRAPH_ALERT_SWEEP_INTERVAL_MS;
  return {
    state: { lastSweepAt: ctx.now, nextWakeAt },
    intents: [{ type: "evaluateGraph", payload: { scheduledFor: ctx.now } }],
    nextWakeAt,
  };
}

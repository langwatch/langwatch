import type {
  Evolution,
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";

/**
 * ADR-052 §4: the graph-alert absence/resolve sweep as a singleton process.
 *
 * The sweep's candidate set is derived from live Postgres (no-data-predicate
 * triggers, open TriggerSent) plus a ClickHouse recency probe — global by
 * nature, so it stays ONE process cluster-wide rather than per-trigger
 * state. Every wake re-arms +30s and emits one sweep intent; the intent
 * handler runs the candidate discovery and evaluations. ProcessWakeWorker's
 * revision fencing replaces the legacy Redis leader lock.
 */
export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;

/** Sentinel scope for the singleton — the ProcessManager* tables key by
 *  (processName, projectId, processKey) and carry no Project FK. */
export const GRAPH_ALERT_SWEEP_PROJECT_ID = "__global__" as const;
export const GRAPH_ALERT_SWEEP_PROCESS_KEY = "graphTriggerHeartbeat" as const;

/** Locked Phase 5 cadence (ADR-034). */
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;

export const GRAPH_ALERT_SWEEP_INTENT_TYPES = {
  SWEEP: "graph-alert-sweep",
} as const;

const BOOTSTRAP_EVENT_TYPE = "graph-alert-sweep-bootstrap" as const;

export interface GraphAlertSweepState {
  /** Epoch ms of the last committed wake (observability only). */
  lastSweepAt: number | null;
}

const INITIAL_STATE: GraphAlertSweepState = { lastSweepAt: null };

/**
 * Worker-boot seed. Date-keyed eventId: the inbox consumes it once per day,
 * so repeated boots the same day no-op while a wiped instance table
 * self-heals within a day.
 */
export function graphAlertSweepBootstrapEnvelope(
  now: number,
): ProcessEventEnvelope {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    eventId: `sweep-bootstrap:${day}`,
    eventType: BOOTSTRAP_EVENT_TYPE,
    occurredAt: now,
    tenantId: GRAPH_ALERT_SWEEP_PROJECT_ID,
    projectId: GRAPH_ALERT_SWEEP_PROJECT_ID,
    processKey: GRAPH_ALERT_SWEEP_PROCESS_KEY,
    payload: {},
  };
}

function armed(
  state: GraphAlertSweepState,
  refMs: number,
  intents: ProcessIntent[] = [],
): Evolution<GraphAlertSweepState> {
  return {
    state,
    nextWakeAt: refMs + GRAPH_ALERT_SWEEP_INTERVAL_MS,
    intents,
  };
}

export const graphAlertSweepProcessDefinition: ProcessDefinition<GraphAlertSweepState> =
  {
    name: GRAPH_ALERT_SWEEP_PROCESS_NAME,
    initialState: INITIAL_STATE,
    evolve({ previousState, input }) {
      if (input.kind === "event") {
        // Bootstrap (or any future event): make sure a wake is armed. No
        // sweep intent — the wake owns sweeping, the bootstrap only seeds.
        return armed(previousState, input.event.occurredAt);
      }
      const scheduledFor = input.scheduledFor;
      return armed({ lastSweepAt: scheduledFor }, scheduledFor, [
        {
          messageKey: `sweep:${scheduledFor}`,
          intentType: GRAPH_ALERT_SWEEP_INTENT_TYPES.SWEEP,
          payload: { scheduledFor },
        },
      ]);
    },
  };

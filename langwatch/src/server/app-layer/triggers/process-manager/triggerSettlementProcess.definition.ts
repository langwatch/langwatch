import type {
  Evolution,
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";

import { computeScheduledFor } from "../dispatch/triggerActionDispatch";
import {
  TRIGGER_SETTLEMENT_INTENT_TYPES,
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  triggerMatchEventViewSchema,
  type NotifyDigestIntent,
  type PersistMatchIntent,
  type TriggerSettlementState,
} from "./triggerSettlementProcess.types";

/**
 * ADR-052: the settle-debounce + cadence-digest timing model (ADR-026/027)
 * as a pure process. One process per (projectId, triggerId); the match
 * subscribers feed one envelope per matched (trigger, trace); wakes drain
 * due matches into ProcessManagerOutbox intents.
 *
 * The state mirrors the process key (`triggerId`) because the generic
 * `evolve` receives no ProcessRef, and the wake drain needs the triggerId to
 * stamp on its intents.
 */

/**
 * Upper bound on simultaneously pending matches per trigger. A match storm
 * beyond this drops the OLDEST pending matches (they are the ones most
 * likely already stale) and counts the drop in state — no silent cap. The
 * legacy queue bounded the same storm via coalesce windows; a trigger
 * matching everything on a busy project is a config smell the ADR-031 caps
 * already punish at dispatch.
 */
export const MAX_PENDING_MATCHES = 1_000;

/** Event type stamped by the match subscribers on their envelopes. */
export const TRIGGER_MATCH_EVENT_TYPE = "trigger-match" as const;

export type SettlementState = TriggerSettlementState & {
  /** Mirror of processKey, written on every match envelope. */
  triggerId?: string;
};

const INITIAL_STATE: SettlementState = {
  pendingMatches: {},
  overflowDropped: 0,
};

/**
 * Deterministic envelope for one matched (trigger, trace). `eventId` is
 * suffixed with the triggerId because the process inbox consumes each
 * sourceEventId once per (processName, projectId) — one pipeline event can
 * legitimately match several triggers.
 */
export function toTriggerMatchEnvelope(params: {
  sourceEventId: string;
  occurredAt: number;
  projectId: string;
  triggerId: string;
  view: unknown;
}): ProcessEventEnvelope {
  return {
    eventId: `${params.sourceEventId}:${params.triggerId}`,
    eventType: TRIGGER_MATCH_EVENT_TYPE,
    occurredAt: params.occurredAt,
    tenantId: params.projectId,
    projectId: params.projectId,
    processKey: params.triggerId,
    payload: params.view as ProcessEventEnvelope["payload"],
  };
}

function nextWakeFrom(state: SettlementState): number | null {
  let min: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (min === null || match.dispatchDueAt < min) min = match.dispatchDueAt;
  }
  return min;
}

function settle(
  state: SettlementState,
  intents: ProcessIntent[] = [],
): Evolution<SettlementState> {
  return { state, nextWakeAt: nextWakeFrom(state), intents };
}

function evolveEvent(
  previousState: SettlementState,
  envelope: ProcessEventEnvelope,
): Evolution<SettlementState> {
  if (envelope.eventType !== TRIGGER_MATCH_EVENT_TYPE) {
    return settle(previousState);
  }
  const view = triggerMatchEventViewSchema.parse(envelope.payload);

  // ADR-026: the settle deadline; a re-match of a pending trace extends it.
  const settleDueAt = envelope.occurredAt + view.traceDebounceMs;
  // ADR-027: the wall-clock boundary snap, computed from the projected
  // settle time so matches inside one cadence window share a boundary.
  const dispatchDueAt = computeScheduledFor({
    action: view.action,
    cadence: view.notificationCadence,
    now: new Date(settleDueAt),
  }).getTime();

  const pendingMatches = {
    ...previousState.pendingMatches,
    [view.traceId]: {
      settleDueAt,
      dispatchDueAt,
      actionClass: view.actionClass,
    },
  };

  // Bound the state row: drop the OLDEST pending matches beyond the cap.
  let overflowDropped = previousState.overflowDropped;
  const keys = Object.keys(pendingMatches);
  if (keys.length > MAX_PENDING_MATCHES) {
    const byAge = keys.sort(
      (a, b) => pendingMatches[a]!.settleDueAt - pendingMatches[b]!.settleDueAt,
    );
    for (const stale of byAge.slice(0, keys.length - MAX_PENDING_MATCHES)) {
      delete pendingMatches[stale];
      overflowDropped++;
    }
  }

  return settle({
    pendingMatches,
    overflowDropped,
    triggerId: envelope.processKey,
  });
}

function evolveWake(
  previousState: SettlementState,
  scheduledFor: number,
): Evolution<SettlementState> {
  const triggerId = previousState.triggerId;
  if (!triggerId) {
    // A wake for a process that never consumed a match — nothing to drain.
    return { state: previousState, nextWakeAt: null, intents: [] };
  }

  const due: Array<[string, SettlementState["pendingMatches"][string]]> = [];
  const remaining: SettlementState["pendingMatches"] = {};
  for (const [traceId, match] of Object.entries(previousState.pendingMatches)) {
    if (match.dispatchDueAt <= scheduledFor) {
      due.push([traceId, match]);
    } else {
      remaining[traceId] = match;
    }
  }
  const drained: SettlementState = { ...previousState, pendingMatches: remaining };
  if (due.length === 0) {
    return settle(drained);
  }

  const intents: ProcessIntent[] = [];

  // Persist never digests (ADR-035): one intent per trace, each with its own
  // message key so retries are independent.
  for (const [traceId, match] of due) {
    if (match.actionClass !== "persist") continue;
    const payload: PersistMatchIntent = { triggerId, traceId };
    intents.push({
      messageKey: `persist:${traceId}`,
      intentType: TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
      payload,
    });
  }

  // Notify digests per boundary: matches that snapped to the same cadence
  // boundary coalesce into one digest (ADR-027). Distinct boundaries that
  // are all overdue (worker downtime) each keep their own digest so the
  // message key stays deterministic under re-delivery.
  const notifyByBoundary = new Map<number, string[]>();
  for (const [traceId, match] of due) {
    if (match.actionClass !== "notify") continue;
    const traces = notifyByBoundary.get(match.dispatchDueAt) ?? [];
    traces.push(traceId);
    notifyByBoundary.set(match.dispatchDueAt, traces);
  }
  for (const [boundary, traceIds] of notifyByBoundary) {
    const payload: NotifyDigestIntent = {
      triggerId,
      traceIds: [...traceIds].sort(),
      boundary,
    };
    intents.push({
      messageKey: `digest:${boundary}`,
      intentType: TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
      payload,
    });
  }

  return settle(drained, intents);
}

export const triggerSettlementProcessDefinition: ProcessDefinition<SettlementState> =
  {
    name: TRIGGER_SETTLEMENT_PROCESS_NAME,
    initialState: INITIAL_STATE,
    evolve({ previousState, input }) {
      return input.kind === "event"
        ? evolveEvent(previousState, input.event)
        : evolveWake(previousState, input.scheduledFor);
    },
  };

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { FeedFn } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type {
  Evolution,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";

import { computeScheduledFor } from "../dispatch/triggerActionDispatch";
import {
  createNotifyDigestHandler,
  createPersistMatchHandler,
  type TriggerSettlementDispatchDeps,
} from "./triggerSettlementIntentHandlers";
import {
  notifyDigestIntentSchema,
  persistMatchIntentSchema,
  TRIGGER_SETTLEMENT_INTENT_TYPES,
  type TriggerMatchEventView,
  type TriggerSettlementState,
} from "./triggerSettlementProcess.types";

/**
 * ADR-052: the settle-debounce + cadence-digest timing model (ADR-026/027)
 * as a process manager. One instance per (projectId, triggerId); the match
 * feeds emit one `trigger-match` fact per matched (trigger, trace); wakes
 * drain due matches into outbox intents.
 */
export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;

/** Facts this PM consumes — feeds type-check against this. */
export interface TriggerSettlementFacts {
  "trigger-match": TriggerMatchEventView;
}

/**
 * Upper bound on simultaneously pending matches per trigger. Overflow
 * drops the OLDEST matches (most likely stale) and counts the drop in
 * state — no silent cap. The ADR-031 caps punish match-everything
 * triggers at dispatch anyway.
 */
export const MAX_PENDING_MATCHES = 1_000;

export type SettlementState = TriggerSettlementState & {
  /** Mirror of the process key — the wake drain needs the triggerId. */
  triggerId?: string;
};

const INITIAL_STATE: SettlementState = {
  pendingMatches: {},
  overflowDropped: 0,
};

function nextWakeFrom(state: SettlementState): number | null {
  let min: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (min === null || match.dispatchDueAt < min) min = match.dispatchDueAt;
  }
  return min;
}

function evolveMatch(
  previousState: SettlementState,
  view: TriggerMatchEventView,
  context: { at: number; key: string },
): Evolution<SettlementState> {
  // ADR-026: the settle deadline; a re-match of a pending trace extends it.
  const settleDueAt = context.at + view.traceDebounceMs;
  // ADR-027: the wall-clock boundary snap, from the projected settle time
  // so matches inside one cadence window share a boundary.
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

  const state: SettlementState = {
    pendingMatches,
    overflowDropped,
    triggerId: context.key,
  };
  return { state, nextWakeAt: nextWakeFrom(state), intents: [] };
}

export interface TriggerSettlementPmDeps {
  dispatch: TriggerSettlementDispatchDeps;
  /** Trace-side match feed (EE — createTraceAlertTriggerMatchFeed). */
  matchFeed: FeedFn<TraceProcessingEvent, TriggerSettlementFacts, TraceSummaryData>;
}

export const triggerSettlementPM =
  (deps: TriggerSettlementPmDeps): ProcessManagerApplier<TraceProcessingEvent> =>
  (pm) =>
    pm
      .state<SettlementState>(INITIAL_STATE)
      .intent(
        TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
        notifyDigestIntentSchema,
        createNotifyDigestHandler(deps.dispatch),
      )
      .intent(
        TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
        persistMatchIntentSchema,
        createPersistMatchHandler(deps.dispatch),
      )
      .on(
        "trigger-match",
        (state, data: TriggerMatchEventView, { at, key }) =>
          evolveMatch(state, data, { at, key }),
      )
      .onWake((previousState, scheduledFor, { intents }) => {
        const triggerId = previousState.triggerId;
        if (!triggerId) {
          // A wake with nothing ever matched — nothing to drain.
          return { state: previousState, nextWakeAt: null, intents: [] };
        }

        const due: Array<
          [string, SettlementState["pendingMatches"][string]]
        > = [];
        const remaining: SettlementState["pendingMatches"] = {};
        for (const [traceId, match] of Object.entries(
          previousState.pendingMatches,
        )) {
          if (match.dispatchDueAt <= scheduledFor) due.push([traceId, match]);
          else remaining[traceId] = match;
        }
        const drained: SettlementState = {
          ...previousState,
          pendingMatches: remaining,
        };
        const emitted: ProcessIntent[] = [];

        // Persist never digests (ADR-035): one intent per trace, each with
        // its own message key so retries are independent.
        for (const [traceId, match] of due) {
          if (match.actionClass !== "persist") continue;
          emitted.push(
            intents[TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH]({
              key: `persist:${traceId}`,
              payload: { triggerId, traceId },
            }),
          );
        }

        // Notify digests coalesce per cadence boundary (ADR-027); distinct
        // overdue boundaries (worker downtime) keep their own digest so the
        // message key stays deterministic under re-delivery.
        const notifyByBoundary = new Map<number, string[]>();
        for (const [traceId, match] of due) {
          if (match.actionClass !== "notify") continue;
          const traces = notifyByBoundary.get(match.dispatchDueAt) ?? [];
          traces.push(traceId);
          notifyByBoundary.set(match.dispatchDueAt, traces);
        }
        for (const [boundary, traceIds] of notifyByBoundary) {
          emitted.push(
            intents[TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST]({
              key: `digest:${boundary}`,
              payload: { triggerId, traceIds: [...traceIds].sort(), boundary },
            }),
          );
        }

        return {
          state: drained,
          nextWakeAt: nextWakeFrom(drained),
          intents: emitted,
        };
      })
      // Match detection rides post-fold traceSummary semantics with the
      // legacy reactor's window (30s delay + per-trace collapse), filtered
      // to genuine message events.
      .trigger({
        fold: "traceSummary",
        events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
        delay: 30_000,
        ttl: 30_000,
        feed: deps.matchFeed,
      })
      .outbox({
        // Parity with the legacy ReactorOutbox rows (maxAttempts 8). The
        // lease must outlive the slowest digest dispatch or a healthy
        // digest loses its lease mid-flight and double-delivers.
        maxAttempts: 8,
        leaseDurationMs: 120_000,
      });

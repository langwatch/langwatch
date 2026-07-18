import { createHash } from "node:crypto";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/automations/schemas/constants";
import type {
  AutomationEvent,
  TriggerMatchRecordedEventData,
} from "~/server/event-sourcing/pipelines/automations/schemas/events";
import { settleWindowBucket } from "~/server/event-sourcing/pipelines/automations/settleWindow";

import { computeScheduledFor } from "../../../../app-layer/automations/dispatch/triggerActionDispatch";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
  type TriggerSettlementDispatchDeps,
} from "./triggerSettlementIntentHandlers";
import {
  logOverflowIntentSchema,
  notifyDigestIntentSchema,
  type PendingMatch,
  persistMatchIntentSchema,
  TRIGGER_SETTLEMENT_INTENT_TYPES,
  type TriggerSettlementState,
} from "./triggerSettlementProcess.types";

export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;
export const MAX_PENDING_MATCHES = 1_000;
export type SettlementState = TriggerSettlementState;

const INITIAL_STATE: SettlementState = {
  pendingMatches: {},
  overflowFlushed: 0,
};

function nextWakeFrom(state: SettlementState): number | null {
  let next: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (next === null || match.dispatchDueAt < next) next = match.dispatchDueAt;
  }
  return next;
}

/** A match evicted from the pending set by the cap — flushed to immediate
 *  dispatch instead of being discarded. */
export interface OverflowFlush {
  traceId: string;
  match: PendingMatch;
}

export function addPending(
  previousState: SettlementState,
  view: TriggerMatchRecordedEventData,
  at: number,
): { state: SettlementState; flushed: OverflowFlush[] } {
  const settleDueAt = at + view.traceDebounceMs;
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
      settleWindowBucket: settleWindowBucket({
        occurredAt: at,
        traceDebounceMs: view.traceDebounceMs,
      }),
    },
  };
  const flushed: OverflowFlush[] = [];
  const traceIds = Object.keys(pendingMatches);
  if (traceIds.length > MAX_PENDING_MATCHES) {
    const oldestFirst = traceIds.sort(
      (left, right) =>
        pendingMatches[left]!.settleDueAt - pendingMatches[right]!.settleDueAt,
    );
    for (const traceId of oldestFirst.slice(
      0,
      traceIds.length - MAX_PENDING_MATCHES,
    )) {
      flushed.push({ traceId, match: pendingMatches[traceId]! });
      delete pendingMatches[traceId];
    }
  }
  return {
    state: {
      pendingMatches,
      overflowFlushed: previousState.overflowFlushed + flushed.length,
    },
    flushed,
  };
}

export function settleBoundary(state: SettlementState): number | null {
  return nextWakeFrom(state);
}

function digestBatchKey(traceIds: readonly string[]): string {
  return createHash("sha256")
    .update(traceIds.join("\0"))
    .digest("hex")
    .slice(0, 16);
}

export function drainDue(state: SettlementState, at: number) {
  const remaining: SettlementState["pendingMatches"] = {};
  const notifyByBoundary = new Map<number, string[]>();
  const settledMatches: Array<{
    traceId: string;
    settleWindowBucket: string;
  }> = [];
  for (const [traceId, match] of Object.entries(state.pendingMatches)) {
    if (match.dispatchDueAt > at) {
      remaining[traceId] = match;
      continue;
    }
    if (match.actionClass === "persist") {
      settledMatches.push({
        traceId,
        settleWindowBucket: match.settleWindowBucket,
      });
      continue;
    }
    const traceIds = notifyByBoundary.get(match.dispatchDueAt) ?? [];
    traceIds.push(traceId);
    notifyByBoundary.set(match.dispatchDueAt, traceIds);
  }
  const nextState = { ...state, pendingMatches: remaining };
  return {
    state: nextState,
    boundaries: Array.from(notifyByBoundary, ([key, traceIds]) => ({
      key,
      traceIds: traceIds.sort(),
    })),
    settledMatches,
    nextBoundary: nextWakeFrom(nextState),
  };
}

export interface TriggerSettlementPmDeps {
  dispatch: TriggerSettlementDispatchDeps;
}

export const triggerSettlementPM =
  (deps: TriggerSettlementPmDeps): ProcessManagerApplier<AutomationEvent> =>
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
      .intent(
        TRIGGER_SETTLEMENT_INTENT_TYPES.LOG_OVERFLOW,
        logOverflowIntentSchema,
        createLogOverflowHandler(),
      )
      .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => {
        const { state: nextState, flushed } = addPending(state, data, ctx.at);
        return {
          state: nextState,
          // Cap hit: the oldest matches dispatch NOW instead of being
          // discarded — degraded batching under extreme load, never loss.
          intents:
            flushed.length > 0
              ? [
                  ...flushed.map(({ traceId, match }) =>
                    match.actionClass === "persist"
                      ? ctx.intents.persistMatch(
                          `persist:${traceId}:${match.settleWindowBucket}`,
                          { triggerId: ctx.key, traceId },
                        )
                      : ctx.intents.notifyDigest(
                          `digest:${match.dispatchDueAt}:${digestBatchKey([traceId])}`,
                          {
                            triggerId: ctx.key,
                            traceIds: [traceId],
                            boundary: match.dispatchDueAt,
                          },
                        ),
                  ),
                  ctx.intents.logOverflow(
                    `overflow:${nextState.overflowFlushed}`,
                    {
                      triggerId: ctx.key,
                      flushed: flushed.length,
                      totalFlushed: nextState.overflowFlushed,
                    },
                  ),
                ]
              : undefined,
          nextWakeAt: settleBoundary(nextState),
        };
      })
      .onWake((state, ctx) => {
        const due = drainDue(state, ctx.at);
        return {
          state: due.state,
          intents: [
            ...due.boundaries.map((boundary) =>
              ctx.intents.notifyDigest(
                `digest:${boundary.key}:${digestBatchKey(boundary.traceIds)}`,
                {
                  triggerId: ctx.key,
                  traceIds: boundary.traceIds,
                  boundary: boundary.key,
                },
              ),
            ),
            ...due.settledMatches.map((match) =>
              ctx.intents.persistMatch(
                `persist:${match.traceId}:${match.settleWindowBucket}`,
                {
                  triggerId: ctx.key,
                  traceId: match.traceId,
                },
              ),
            ),
          ],
          nextWakeAt: due.nextBoundary,
        };
      })
      .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 });

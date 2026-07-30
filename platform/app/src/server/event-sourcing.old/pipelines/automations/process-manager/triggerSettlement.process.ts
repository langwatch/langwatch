import { createHash } from "node:crypto";
import type { TriggerMatchRecordedEventData } from "~/server/event-sourcing.old/pipelines/automations/schemas/events";
import { settleWindowBucket } from "~/server/event-sourcing.old/pipelines/automations/settleWindow";

import { computeScheduledFor } from "../../../../app-layer/automations/dispatch/triggerActionDispatch";
import type {
  PendingMatch,
  TriggerSettlementState,
} from "./triggerSettlementProcess.types";

/**
 * The pipeline mounts this process WITHOUT a `toPayload`, and that is
 * deliberate rather than drift: `triggerMatchRecordedEventDataSchema` is
 * already identities-and-flags with trace/span/message content forbidden, which
 * is exactly the case `ProcessManagerDefinition.toPayload` carves out as safe
 * to default. Add one the moment this event's data grows a content field.
 */
export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;
export const MAX_PENDING_MATCHES = 1_000;
export type SettlementState = TriggerSettlementState;

export const INITIAL_SETTLEMENT_STATE: SettlementState = {
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

export function digestBatchKey(traceIds: readonly string[]): string {
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

/**
 * The `triggerSettlement` process-manager topology, exported standalone so the
 * pipeline mounts one expression of it and tests can build the exact definition
 * the runtime runs. `automations/pipeline.ts` mounts it as
 * `.withProcessManager(TRIGGER_SETTLEMENT_PROCESS_NAME,
 * triggerSettlementPM(deps.dispatch))`.
 */
export function triggerSettlementPM(
  dispatch: TriggerSettlementDispatchDeps,
): ProcessManagerApplier<AutomationEvent> {
  return (pm) =>
    pm
      .state<SettlementState>(INITIAL_SETTLEMENT_STATE)
      .intent(
        TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
        notifyDigestIntentSchema,
        createNotifyDigestHandler(dispatch),
      )
      .intent(
        TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
        persistMatchIntentSchema,
        createPersistMatchHandler(dispatch),
      )
      .intent(
        TRIGGER_SETTLEMENT_INTENT_TYPES.LOG_OVERFLOW,
        logOverflowIntentSchema,
        createLogOverflowHandler(),
      )
      .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => {
        // Schedule from max(at, now), never `at` alone — see `now`'s docblock
        // on EventContext. A lagged match otherwise settles on a boundary
        // already in the past, and `computeScheduledFor` returns a due time
        // behind the present, so every trace flushes as its own digest during
        // exactly the backlog the coalescing exists for.
        const handledAt = Math.max(ctx.at, ctx.now);
        const { state: nextState, flushed } = addPending(
          state,
          data,
          handledAt,
        );
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
        // Same clamp as the match path: a wake delivered late must drain what
        // is due NOW, not what was due when the wake was written.
        const due = drainDue(state, Math.max(ctx.at, ctx.now));
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
}

import { createLogger } from "@langwatch/observability";
import { createHash } from "node:crypto";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { AutomationEvent } from "~/server/event-sourcing/pipelines/automations/schemas/events";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/automations/schemas/constants";

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

const logger = createLogger("langwatch:triggers:trigger-settlement");

export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;
export const MAX_PENDING_MATCHES = 1_000;
export type SettlementState = TriggerSettlementState;

const INITIAL_STATE: SettlementState = {
  pendingMatches: {},
  overflowDropped: 0,
};

function nextWakeFrom(state: SettlementState): number | null {
  let next: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (next === null || match.dispatchDueAt < next) next = match.dispatchDueAt;
  }
  return next;
}

export function addPending(
  previousState: SettlementState,
  view: TriggerMatchEventView,
  at: number,
): SettlementState {
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
    },
  };
  let overflowDropped = previousState.overflowDropped;
  const traceIds = Object.keys(pendingMatches);
  if (traceIds.length > MAX_PENDING_MATCHES) {
    const oldestFirst = traceIds.sort(
      (left, right) =>
        pendingMatches[left]!.settleDueAt - pendingMatches[right]!.settleDueAt,
    );
    const overflow = oldestFirst.slice(
      0,
      traceIds.length - MAX_PENDING_MATCHES,
    );
    for (const traceId of overflow) delete pendingMatches[traceId];
    overflowDropped += overflow.length;
    logger.warn(
      { triggerId: view.triggerId, dropped: overflow.length },
      "Dropped oldest pending automation matches at the state bound",
    );
  }
  return { pendingMatches, overflowDropped };
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
  const settledMatches: Array<{ traceId: string }> = [];
  for (const [traceId, match] of Object.entries(state.pendingMatches)) {
    if (match.dispatchDueAt > at) {
      remaining[traceId] = match;
      continue;
    }
    if (match.actionClass === "persist") {
      settledMatches.push({ traceId });
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

export const triggerSettlementPM = (
  deps: TriggerSettlementPmDeps,
): ProcessManagerApplier<AutomationEvent> =>
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
      .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => {
        const nextState = addPending(state, data, ctx.at);
        return {
          state: nextState,
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
              ctx.intents.persistMatch(`persist:${match.traceId}`, {
                triggerId: ctx.key,
                traceId: match.traceId,
              }),
            ),
          ],
          nextWakeAt: due.nextBoundary,
        };
      })
      .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 });

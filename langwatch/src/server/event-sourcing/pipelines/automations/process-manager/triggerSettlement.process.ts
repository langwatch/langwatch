import { createHash } from "node:crypto";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/automations/schemas/constants";
import type {
  AutomationEvent,
  TriggerMatchRecordedEventData,
} from "~/server/event-sourcing/pipelines/automations/schemas/events";
import { settleWindowBucket } from "~/server/event-sourcing/pipelines/automations/settleWindow";

import { computeScheduledFor } from "@langwatch/automations-server/dispatch/trigger-action-dispatch";
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

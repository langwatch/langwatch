import { createHash } from "node:crypto";

import {
  CADENCE_WINDOW_MS,
  type NotificationCadence,
  type TriggerAction,
  type TriggerMatchRecordedEventData,
} from "@langwatch/automation-contract";
import { Temporal, type Instant } from "@langwatch/time";

import {
  MAX_PENDING_MATCHES,
  PERSIST_PAGE_MAX,
  type OverflowFlush,
  type PersistPage,
  type SettlementState,
} from "../eventing/trigger-settlement.process.ts";

const PERSIST_TRIGGER_ACTIONS = new Set<TriggerAction>([
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
]);

// When trigger matches settle; holds pending set and drain boundary to cap
// reads and notifications.
function computeScheduledFor({
  action,
  cadence,
  now,
}: {
  action: TriggerAction;
  cadence: NotificationCadence;
  now: Instant;
}): Instant {
  if (PERSIST_TRIGGER_ACTIONS.has(action) || cadence === "immediate") {
    return now;
  }

  const windowMs = CADENCE_WINDOW_MS[cadence];
  return Temporal.Instant.fromEpochMilliseconds(
    (Math.floor(now.epochMilliseconds / windowMs) + 1) * windowMs,
  );
}

function pendingDueTimes(state: SettlementState): number[] {
  return Object.values(state.pendingMatches).map((match) => match.dispatchDueAt);
}

export function settleWindowBucket({
  occurredAt,
  traceDebounceMs,
}: {
  occurredAt: number;
  traceDebounceMs: number;
}): string {
  const bucketIndex = Math.floor(occurredAt / Math.max(traceDebounceMs, 1));
  return `${traceDebounceMs}-${bucketIndex}`;
}

export function addPending(
  previousState: SettlementState,
  view: TriggerMatchRecordedEventData,
  at: number,
): { state: SettlementState; flushed: OverflowFlush[]; nextBoundary: number | null } {
  const settleDueAt = at + view.traceDebounceMs;
  const dispatchDueAt = computeScheduledFor({
    action: view.action,
    cadence: view.notificationCadence,
    now: Temporal.Instant.fromEpochMilliseconds(settleDueAt),
  }).epochMilliseconds;
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
    const oldestFirst = traceIds.toSorted(
      (left, right) => pendingMatches[left]!.settleDueAt - pendingMatches[right]!.settleDueAt,
    );
    for (const traceId of oldestFirst.slice(0, traceIds.length - MAX_PENDING_MATCHES)) {
      flushed.push({ traceId, match: pendingMatches[traceId]! });
      delete pendingMatches[traceId];
    }
  }
  const state = {
    pendingMatches,
    overflowFlushed: previousState.overflowFlushed + flushed.length,
  };
  const dueTimes = pendingDueTimes(state);
  return { state, flushed, nextBoundary: dueTimes.length === 0 ? null : Math.min(...dueTimes) };
}

export function digestBatchKey(traceIds: readonly string[]): string {
  return createHash("sha256").update(traceIds.join("\0")).digest("hex").slice(0, 16);
}

/**
 * Chunks settled persist matches into deterministic pages: sorted by
 * traceId, sliced by PERSIST_PAGE_MAX -- the sort is what guarantees
 * byte-identical page keys on retry, regardless of insertion order.
 */
export function pagePersistMatches({
  matches,
}: {
  matches: { traceId: string; settleWindowBucket: string }[];
}): PersistPage[] {
  // Byte order, not localeCompare: the page key must never depend on the
  // process locale or ICU version.
  const sorted = [...matches].toSorted((left, right) =>
    compareByteOrder(left.traceId, right.traceId),
  );
  const pages: PersistPage[] = [];
  for (let start = 0; start < sorted.length; start += PERSIST_PAGE_MAX) {
    const page = sorted.slice(start, start + PERSIST_PAGE_MAX);
    pages.push({
      traceIds: page.map((match) => match.traceId),
      pageKey: digestBatchKey(page.map((match) => `${match.traceId}@${match.settleWindowBucket}`)),
    });
  }
  return pages;
}

export function drainDue(
  state: SettlementState,
  at: number,
): {
  state: SettlementState;
  boundaries: { key: number; traceIds: string[] }[];
  persistPages: PersistPage[];
  nextBoundary: number | null;
} {
  const remaining: SettlementState["pendingMatches"] = {};
  const notifyByBoundary = new Map<number, string[]>();
  const settledMatches: {
    traceId: string;
    settleWindowBucket: string;
  }[] = [];
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
  const remainingDue = pendingDueTimes(nextState);
  return {
    state: nextState,
    boundaries: Array.from(notifyByBoundary, ([key, traceIds]) => ({
      key,
      traceIds: traceIds.toSorted(),
    })),
    persistPages: pagePersistMatches({ matches: settledMatches }),
    nextBoundary: remainingDue.length === 0 ? null : Math.min(...remainingDue),
  };
}

function compareByteOrder(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

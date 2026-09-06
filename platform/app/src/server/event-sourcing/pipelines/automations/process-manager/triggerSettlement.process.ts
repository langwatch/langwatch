import { createHash } from "node:crypto";
import type { TriggerMatchRecordedEventData } from "~/server/event-sourcing/pipelines/automations/schemas/events";
import { settleWindowBucket } from "~/server/event-sourcing/pipelines/automations/settleWindow";

import { computeScheduledFor } from "../../../../app-layer/automations/dispatch/triggerActionDispatch";
import type {
  PendingMatch,
  TriggerSettlementState,
} from "./triggerSettlementProcess.types";

export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;
export const MAX_PENDING_MATCHES = 1_000;
/**
 * Traces per persist-match outbox message. Sized so a page stays well
 * inside the outbox lease even when the per-trace confirm degrades to
 * seconds: 25 traces through the handler's 4-wide pool at a degraded ~4s
 * per trace is ~25-30s against a 300s lease.
 */
export const PERSIST_PAGE_MAX = 25;
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

/** One persist-match outbox message: a bounded page of settled traces. */
export interface PersistPage {
  traceIds: string[];
  /**
   * Deterministic message-key body. The settle window bucket is INSIDE the
   * hash on purpose: keyed on traceIds alone, a later settlement round over
   * the same traces would collide with the completed page's outbox row and
   * be swallowed by the outbox dedup.
   */
  pageKey: string;
}

/**
 * Chunks settled persist matches into deterministic pages: sorted by
 * traceId, sliced by PERSIST_PAGE_MAX. Evolve retries and event redelivery
 * re-run this on identical state, so identical input must produce
 * byte-identical page keys — the sort is what guarantees it regardless of
 * pending-map insertion order.
 */
export function pagePersistMatches({
  matches,
}: {
  matches: Array<{ traceId: string; settleWindowBucket: string }>;
}): PersistPage[] {
  // Byte order, not localeCompare: the page key must never depend on the
  // process locale or ICU version.
  const sorted = [...matches].sort((left, right) =>
    left.traceId < right.traceId ? -1 : left.traceId > right.traceId ? 1 : 0,
  );
  const pages: PersistPage[] = [];
  for (let start = 0; start < sorted.length; start += PERSIST_PAGE_MAX) {
    const page = sorted.slice(start, start + PERSIST_PAGE_MAX);
    pages.push({
      traceIds: page.map((match) => match.traceId),
      pageKey: digestBatchKey(
        page.map((match) => `${match.traceId}@${match.settleWindowBucket}`),
      ),
    });
  }
  return pages;
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
    persistPages: pagePersistMatches({ matches: settledMatches }),
    nextBoundary: nextWakeFrom(nextState),
  };
}

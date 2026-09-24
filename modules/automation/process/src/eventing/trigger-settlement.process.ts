import { createHash } from "node:crypto";

import {
  CADENCE_WINDOW_MS,
  type NotificationCadence,
  type TriggerAction,
  type TriggerActionClass,
  type TriggerMatchRecordedEventData,
} from "@langwatch/automation-contract";
import { Temporal, type Instant } from "@langwatch/time";

export interface PendingMatch {
  settleDueAt: number;
  dispatchDueAt: number;
  actionClass: TriggerActionClass;
  settleWindowBucket: string;
}

export interface TriggerSettlementState {
  pendingMatches: Record<string, PendingMatch>;
  overflowFlushed: number;
}

export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;
export const MAX_PENDING_MATCHES = 1_000;
/**
 * Traces per persist-match outbox message, sized to stay inside the
 * outbox lease even degraded: 25 traces through a 4-wide pool at ~4s
 * each is ~25-30s against a 300s lease.
 */
export const PERSIST_PAGE_MAX = 25;
export type SettlementState = TriggerSettlementState;

export const INITIAL_SETTLEMENT_STATE: SettlementState = {
  pendingMatches: {},
  overflowFlushed: 0,
};

const PERSIST_TRIGGER_ACTIONS = new Set<TriggerAction>([
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
]);

/** A match evicted from the pending set by the cap — flushed to immediate
 *  dispatch instead of being discarded. */
export interface OverflowFlush {
  traceId: string;
  match: PendingMatch;
}

/** One persist-match outbox message: a bounded page of settled traces. */
export interface PersistPage {
  traceIds: string[];
  /**
   * Deterministic message-key body. The settle window bucket is INSIDE
   * the hash on purpose: keyed on traceIds alone, a later round over the
   * same traces would collide with the completed page and be swallowed.
   */
  pageKey: string;
}

// When trigger matches settle; holds pending set and drain boundary to cap
// reads and notifications.
export class TriggerSettlement {
  private static computeScheduledFor({
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

  private static nextWakeFrom(state: SettlementState): number | null {
    let next: number | null = null;
    for (const match of Object.values(state.pendingMatches)) {
      if (next === null || match.dispatchDueAt < next) next = match.dispatchDueAt;
    }
    return next;
  }

  static settleWindowBucket({
    occurredAt,
    traceDebounceMs,
  }: {
    occurredAt: number;
    traceDebounceMs: number;
  }): string {
    const bucketIndex = Math.floor(occurredAt / Math.max(traceDebounceMs, 1));
    return `${traceDebounceMs}-${bucketIndex}`;
  }

  static addPending(
    previousState: SettlementState,
    view: TriggerMatchRecordedEventData,
    at: number,
  ): { state: SettlementState; flushed: OverflowFlush[] } {
    const settleDueAt = at + view.traceDebounceMs;
    const dispatchDueAt = TriggerSettlement.computeScheduledFor({
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
        settleWindowBucket: TriggerSettlement.settleWindowBucket({
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
    return {
      state: {
        pendingMatches,
        overflowFlushed: previousState.overflowFlushed + flushed.length,
      },
      flushed,
    };
  }

  static findNextBoundary(state: SettlementState): number | null {
    return TriggerSettlement.nextWakeFrom(state);
  }

  static digestBatchKey(traceIds: readonly string[]): string {
    return createHash("sha256").update(traceIds.join("\0")).digest("hex").slice(0, 16);
  }

  /**
   * Chunks settled persist matches into deterministic pages: sorted by
   * traceId, sliced by PERSIST_PAGE_MAX -- the sort is what guarantees
   * byte-identical page keys on retry, regardless of insertion order.
   */
  static pagePersistMatches({
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
        pageKey: TriggerSettlement.digestBatchKey(
          page.map((match) => `${match.traceId}@${match.settleWindowBucket}`),
        ),
      });
    }
    return pages;
  }

  static drainDue(
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
    return {
      state: nextState,
      boundaries: Array.from(notifyByBoundary, ([key, traceIds]) => ({
        key,
        traceIds: traceIds.toSorted(),
      })),
      persistPages: TriggerSettlement.pagePersistMatches({ matches: settledMatches }),
      nextBoundary: TriggerSettlement.nextWakeFrom(nextState),
    };
  }
}

function compareByteOrder(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

import { createHash } from "node:crypto";
import {
  CADENCE_WINDOW_MS,
  type NotificationCadence,
  type TriggerAction,
  type TriggerActionClass,
  type TriggerMatchRecordedEventData,
} from "@langwatch/automation-contract";

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
   * Deterministic message-key body. The settle window bucket is INSIDE the
   * hash on purpose: keyed on traceIds alone, a later settlement round over
   * the same traces would collide with the completed page's outbox row and
   * be swallowed by the outbox dedup.
   */
  pageKey: string;
}

/**
 * When a trigger's matches settle, and what is carried until they do.
 *
 * Matches arrive continuously and are notified in batches, so this holds the
 * pending set and the boundary it drains at. The two bounds are the point:
 * pending matches are capped, and a drain is paged, because a trigger that
 * matched a whole backfill must not turn one notification into an unbounded
 * read.
 */
export class TriggerSettlement {
  private static computeScheduledFor({
    action,
    cadence,
    now,
  }: {
    action: TriggerAction;
    cadence: NotificationCadence;
    now: Date;
  }): Date {
    if (PERSIST_TRIGGER_ACTIONS.has(action) || cadence === "immediate") {
      return now;
    }

    const windowMs = CADENCE_WINDOW_MS[cadence];
    return new Date((Math.floor(now.getTime() / windowMs) + 1) * windowMs);
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
      now: new Date(settleDueAt),
    }).getTime();
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
      const oldestFirst = traceIds.sort(
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

  static settleBoundary(state: SettlementState): number | null {
    return TriggerSettlement.nextWakeFrom(state);
  }

  static digestBatchKey(traceIds: readonly string[]): string {
    return createHash("sha256").update(traceIds.join("\0")).digest("hex").slice(0, 16);
  }

  /**
   * Chunks settled persist matches into deterministic pages: sorted by
   * traceId, sliced by PERSIST_PAGE_MAX. Evolve retries and event redelivery
   * re-run this on identical state, so identical input must produce
   * byte-identical page keys — the sort is what guarantees it regardless of
   * pending-map insertion order.
   */
  static pagePersistMatches({
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
        pageKey: TriggerSettlement.digestBatchKey(
          page.map((match) => `${match.traceId}@${match.settleWindowBucket}`),
        ),
      });
    }
    return pages;
  }

  static drainDue(state: SettlementState, at: number) {
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
      persistPages: TriggerSettlement.pagePersistMatches({ matches: settledMatches }),
      nextBoundary: TriggerSettlement.nextWakeFrom(nextState),
    };
  }
}

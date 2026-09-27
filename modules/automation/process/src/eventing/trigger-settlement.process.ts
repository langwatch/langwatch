import type { TriggerActionClass } from "@langwatch/automation-contract";

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

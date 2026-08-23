import type { TenantId } from "../domain/tenantId";
import type { RetentionPolicy } from "../runtime.types";

/**
 * A closed time range (ms since epoch) bounding a store's backing-table read
 * so a time-partitioned table can prune partitions instead of scanning them
 * all (including the cold S3 tier).
 */
export interface ReadTimeWindow {
  fromMs: number;
  toMs: number;
}

/** The window of `widthMs` on each side of `anchorMs`. */
export function readWindowAround({
  anchorMs,
  widthMs,
}: {
  anchorMs: number;
  widthMs: number;
}): ReadTimeWindow {
  return { fromMs: anchorMs - widthMs, toMs: anchorMs + widthMs };
}

/**
 * Context passed to projection stores for both fold and map projections.
 * Provides the minimum information needed for tenant-scoped persistence.
 */
export interface ProjectionStoreContext {
  /** The aggregate this projection belongs to. */
  aggregateId: string;

  /** Tenant identifier for multi-tenant isolation. */
  tenantId: TenantId;

  /** Custom projection key. Defaults to aggregateId when not set. */
  key?: string;

  /**
   * occurredAt (ms) of the event currently being processed, when known. It is
   * purely informational — a store that wants its backing read time-bounded
   * should rely on `readWindow` (declared on the fold definition) rather than
   * deriving a window of its own from this value.
   */
  occurredAtMs?: number;

  /**
   * Time bound for the store's backing-table read, computed by the executor
   * from the event's business time and the width the fold DECLARED
   * (`FoldProjectionOptions.readWindow`). A store passes it through to its
   * repository verbatim; it never chooses a width or implements a miss
   * fallback itself — on a windowed miss the executor retries the read once
   * without the window, so a row outside the window is still found and a
   * live aggregate never reads back as null just because the window missed.
   */
  readWindow?: ReadTimeWindow;

  /**
   * Skip the read cache for this read and go straight to the durable tier.
   *
   * Set by the executor on its read-window fallback: the retry runs moments
   * after the windowed attempt already consulted the cache, so re-reading
   * Redis is a guaranteed second miss that would double-count the cache (and
   * dedup-unavailable) metrics and waste a round-trip. Stores without a cache
   * tier ignore it.
   */
  bypassReadCache?: boolean;

  /**
   * Resolved retention policy for the tenant. Absent/null means the resolver
   * could not produce a value (no resolver wired, or project unresolvable); the
   * write path then stamps PLATFORM_DEFAULT_RETENTION_DAYS, NOT indefinite —
   * retention is default-on, so a missing policy must never leave rows
   * unbounded.
   */
  retentionPolicy?: RetentionPolicy | null;

  /**
   * Ids of the events folded into the state being stored.
   *
   * Recorded alongside the cached state so a redelivery can be recognised.
   * Queue delivery is at-least-once: a fold job that fails after its state was
   * stored is re-dispatched with the same events, and most fold handlers
   * accumulate (counters, sums, appends) rather than being idempotent, so
   * re-applying them would double-count. Absent for stores that do not cache.
   */
  appliedEventIds?: readonly string[];

  /**
   * Which delivery of this job is being folded. 1 is a fresh delivery, higher
   * values are retries of a chain that has not acked.
   *
   * This is `JobDelivery.attempt` under a longer name, and the pair below is
   * `JobDelivery.isContinuation`. The prefix is deliberate rather than drift:
   * `JobDelivery` describes one delivery and nothing else, so a bare `attempt`
   * reads fine there, while this context is a grab-bag also carrying
   * `aggregateId`, `tenantId`, `key` and `retentionPolicy` — an unqualified
   * `attempt` here would not say attempt of what. Noted once so the next
   * reader following the value across the boundary does not have to re-derive
   * it (#6699).
   *
   * A caching store uses it to decide whether the ids it already recorded are
   * still live. On a fresh delivery the previous batch for this group must have
   * acked — the queue holds one active batch per group — so those ids can never
   * be redelivered and are discarded. During a retry chain they must be kept,
   * or a later attempt re-applies the batch the first attempt already folded.
   */
  deliveryAttempt?: number;
  /**
   * True when this commit belongs to a later sub-batch of the same locked
   * dispatch whose earlier sub-batch already committed (batch bisection). The
   * applied-event-id set must be extended, not replaced (#6578).
   */
  isDeliveryContinuation?: boolean;
}

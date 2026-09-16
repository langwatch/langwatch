import type { TenantId } from "../domain/tenantId.ts";
import type { RetentionPolicy } from "../runtime.types.ts";

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
   * occurredAt (ms) of the event currently being processed, when known —
   * purely informational. A store wanting its read time-bounded should rely
   * on `readWindow` instead of deriving one from this value.
   */
  occurredAtMs?: number;

  /**
   * Time bound for the store's backing-table read. Store passes it verbatim;
   * executor retries without window on miss.
   */
  readWindow?: ReadTimeWindow;

  /**
   * Skip the read cache and go to durable tier. Set by executor on read-window
   * fallback to avoid re-consulting Redis (guaranteed miss, double-counts metrics).
   */
  bypassReadCache?: boolean;

  /**
   * Resolved retention policy for the tenant. Absent/null means the resolver
   * could not produce a value; the write path then stamps the platform
   * default, NOT indefinite — retention is default-on, never unbounded.
   */
  retentionPolicy?: RetentionPolicy | null;

  /**
   * Event ids folded into the state. Recorded with cached state to recognize
   * redeliveries (queue is at-least-once; re-apply would double-count).
   */
  appliedEventIds?: readonly string[];

  /**
   * Which delivery (1 = fresh, >1 = retry). Fresh: discard recorded ids
   * (previous batch acked). Retry: keep ids (else re-apply batch).
   */
  deliveryAttempt?: number;
  /**
   * True when this commit belongs to a later sub-batch of the same locked
   * dispatch whose earlier sub-batch already committed (batch bisection). The
   * applied-event-id set must be extended, not replaced (#6578).
   */
  isDeliveryContinuation?: boolean;
}

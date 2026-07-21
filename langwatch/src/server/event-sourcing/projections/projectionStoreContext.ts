import type { ResolvedRetention } from "../../data-retention/retentionPolicy.schema";
import type { TenantId } from "../domain/tenantId";

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
   * occurredAt (ms) of the event currently being processed, when known. Stores
   * may use it as a best-effort hint to prune a time-partitioned read of their
   * backing table (e.g. the trace summary store narrows its trace_summaries
   * lookup to a window around this time instead of scanning every partition).
   * It is purely an optimisation — stores must stay correct when it is absent.
   */
  occurredAtMs?: number;

  /**
   * Resolved retention policy for the tenant. Absent/null means the resolver
   * could not produce a value (no resolver wired, or project unresolvable); the
   * write path then stamps PLATFORM_DEFAULT_RETENTION_DAYS, NOT indefinite —
   * retention is default-on, so a missing policy must never leave rows
   * unbounded.
   */
  retentionPolicy?: ResolvedRetention | null;

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
   * A caching store uses it to decide whether the ids it already recorded are
   * still live. On a fresh delivery the previous batch for this group must have
   * acked — the queue holds one active batch per group — so those ids can never
   * be redelivered and are discarded. During a retry chain they must be kept,
   * or a later attempt re-applies the batch the first attempt already folded.
   */
  deliveryAttempt?: number;
}

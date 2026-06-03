import type { TenantId } from "../domain/tenantId";
import type { ResolvedRetention } from "../../data-retention/retentionPolicy.schema";

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
}

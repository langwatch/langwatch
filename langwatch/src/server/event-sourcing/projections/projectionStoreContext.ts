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
}

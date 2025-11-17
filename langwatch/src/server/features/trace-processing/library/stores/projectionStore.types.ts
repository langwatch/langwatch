import type { Projection } from "../core/types";

/**
 * Context for reading projections from the projection store.
 * 
 * **Security Note:** tenantId is REQUIRED for tenant isolation.
 * All queries MUST filter by tenant to prevent cross-tenant data access.
 */
export interface ProjectionStoreReadContext {
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: string;
  /**
   * Additional metadata for the read operation.
   * Should not be used to bypass security checks.
   */
  metadata?: Record<string, unknown>;
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw?: Record<string, unknown>;
}

/**
 * Context for writing projections to the projection store.
 * Same as read context, with additional concurrency considerations.
 */
export type ProjectionStoreWriteContext = ProjectionStoreReadContext;

/**
 * Store interface for managing projections.
 * 
 * **Implementation Requirements:**
 * - MUST validate projections using isValidProjection before storage
 * - MUST enforce tenant isolation
 * - SHOULD implement optimistic locking to detect concurrent updates
 * - SHOULD support upsert semantics (create or update)
 * 
 * **Concurrency Considerations:**
 * The current interface uses "last write wins" semantics, which can lose updates
 * under concurrent writes. Consider extending with version-based conflict detection:
 * 
 * Example enhanced interface:
 * ```typescript
 * storeProjection(projection, context): Promise<{ success: boolean; conflict?: ProjectionType }>
 * ```
 */
export interface ProjectionStore<
  AggregateId = string,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>
> {
  /**
   * Retrieves a projection for a given aggregate.
   * 
   * @param aggregateId - The aggregate to fetch projection for
   * @param context - Optional filtering/security context
   * @returns The projection if it exists, null otherwise
   * 
   * **Security:** MUST enforce tenant isolation when context.tenantId is provided.
   */
  getProjection(
    aggregateId: AggregateId,
    context?: ProjectionStoreReadContext
  ): Promise<ProjectionType | null>;
  
  /**
   * Stores or updates a projection.
   * 
   * @param projection - The projection to store. MUST be validated before storage.
   * @param context - Optional security/metadata context
   * @throws {Error} If projection is malformed or validation fails
   * 
   * **Security:** Implementations MUST extract and enforce tenant boundaries from projection.
   * **Concurrency:** Current design is "last write wins". Consider adding optimistic locking.
   * **Race Condition Warning:** Multiple concurrent rebuilds of the same aggregate can
   * result in lost updates. Implementers should consider adding version checks.
   */
  storeProjection(
    projection: ProjectionType,
    context?: ProjectionStoreWriteContext
  ): Promise<void>;
}



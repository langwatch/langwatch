import { z } from "zod";
import { type TenantId, TenantIdSchema } from "../domain/tenantId";
import type { Projection } from "../domain/types";

/**
 * Zod schema for projection store read context.
 * Context for reading projections from the projection store.
 *
 * **Security Note:** tenantId is REQUIRED for tenant isolation.
 * All queries MUST filter by tenant to prevent cross-tenant data access.
 */
export const ProjectionStoreReadContextSchema = z.object({
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: TenantIdSchema,
  /**
   * Additional metadata for the read operation.
   * Should not be used to bypass security checks.
   */
  metadata: z.record(z.unknown()).optional(),
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw: z.record(z.unknown()).optional(),
});

export interface ProjectionStoreReadContext {
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: TenantId;
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
 * - MUST validate tenantId using validateTenantId() before any operations
 * - MUST enforce tenant isolation
 * - SHOULD implement optimistic locking to detect concurrent updates
 * - SHOULD support upsert semantics (create or update)
 *
 * **Concurrency Considerations:**
 * The current interface uses "last write wins" semantics, which can lose updates
 * under concurrent writes. This is acceptable for event-sourced systems where:
 * - Events are the source of truth
 * - Projections can be rebuilt from events
 * - Concurrent rebuilds of the same aggregate are rare
 *
 * **Future Enhancement - Optimistic Locking:**
 * For systems requiring stronger consistency guarantees, consider implementing
 * optimistic locking with version-based conflict detection:
 *
 * ```typescript
 * interface ProjectionStoreWithOptimisticLocking {
 *   storeProjection(
 *     projection: ProjectionType,
 *     context: ProjectionStoreWriteContext
 *   ): Promise<{ success: boolean; conflict?: ProjectionType }>;
 * }
 * ```
 *
 * This would allow detection of concurrent updates and enable retry logic or
 * conflict resolution strategies. However, this adds complexity and may not be
 * necessary if queue-level ordering (GroupQueue) is used at the service level (see EventSourcingService).
 */
export interface ProjectionStore<
  ProjectionType extends Projection = Projection,
> {
  /**
   * Retrieves a projection for a given aggregate.
   *
   * @param aggregateId - The aggregate to fetch projection for
   * @param context - Security context with required tenantId
   * @returns The projection if it exists, null otherwise
   * @throws {Error} If tenantId is missing or invalid
   *
   * **Security:** Implementations MUST call validateTenantId(context, 'getProjection')
   * before executing the query to ensure tenant isolation.
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores or updates a projection.
   *
   * @param projection - The projection to store. MUST be validated before storage.
   * @param context - Security context with required tenantId
   * @throws {Error} If projection is malformed, tenantId is missing, or validation fails
   *
   * **Security:** Implementations MUST:
   * 1. Call validateTenantId(context, 'storeProjection') to ensure tenantId is present
   * 2. Verify projection belongs to the same tenant as context
   * 3. Filter all queries by tenantId to prevent cross-tenant access
   *
   * **Concurrency:** Current design is "last write wins". Consider adding optimistic locking.
   * **Race Condition Warning:** Multiple concurrent rebuilds of the same aggregate can
   * result in lost updates. Implementers should consider adding version checks.
   *
   * @example
   * ```typescript
   * async storeProjection(projection: Projection, context: { tenantId: string }): Promise<void> {
   *   EventUtils.validateTenantId(context, 'ProjectionStore.storeProjection');
   *   EventUtils.isValidProjection(projection); // also validate the projection itself
   *   // ... proceed with storage, ensuring tenant isolation
   * }
   * ```
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}

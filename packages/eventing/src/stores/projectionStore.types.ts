import { z } from "zod";

import { type TenantId, TenantIdSchema } from "../domain/tenantId.ts";
import type { Projection } from "../domain/types.ts";

/**
 * Read context for the projection store.
 * **Security:** tenantId is REQUIRED — queries must filter by tenant.
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
  metadata: z.record(z.string(), z.unknown()).optional(),
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw: z.record(z.string(), z.unknown()).optional(),
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
 * Store interface for projections; validates and enforces tenant isolation.
 * Uses "last write wins" semantics; rebuilds from events for consistency.
 */
export interface ProjectionStore<ProjectionType extends Projection = Projection> {
  /**
   * Retrieves a projection for an aggregate; validates tenant isolation.
   */
  findProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores or updates a projection; validates and verifies tenant ownership.
   * "Last write wins"; consider adding optimistic locking for concurrent rebuilds.
   */
  storeProjection(projection: ProjectionType, context: ProjectionStoreWriteContext): Promise<void>;

  /**
   * Optional batch store for persisting multiple projections in a single INSERT.
   * Used by projection-replay to batch thousands of rows per ClickHouse INSERT.
   * Falls back to sequential storeProjection() calls if not implemented.
   */
  storeProjectionBatch?(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}

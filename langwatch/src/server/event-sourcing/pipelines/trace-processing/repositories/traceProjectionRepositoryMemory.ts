import type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { TraceProjection } from "../types";
import { EventUtils } from "../../../library";

/**
 * In-memory implementation of ProjectionStore for testing/fallback.
 */
export class TraceProjectionRepositoryMemory
  implements ProjectionStore<string, TraceProjection>
{
  private readonly projectionsByTenant = new Map<
    string,
    Map<string, TraceProjection>
  >();

  async getProjection(
    traceId: string,
    context: ProjectionStoreReadContext,
  ): Promise<TraceProjection | null> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "TraceProjectionRepositoryMemory.getProjection");

    const tenantProjections = this.projectionsByTenant.get(
      String(context.tenantId),
    );
    return tenantProjections?.get(traceId) ?? null;
  }

  async storeProjection(
    projection: TraceProjection,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(
      context,
      "TraceProjectionRepositoryMemory.storeProjection",
    );

    // Validate projection has tenantId
    if (!EventUtils.isValidProjection(projection)) {
      throw new Error(
        "[VALIDATION] Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
      );
    }

    // Validate that projection tenantId matches context tenantId
    const projectionTenantId = projection.tenantId;
    if (!projectionTenantId) {
      throw new Error("[SECURITY] Projection has no tenantId");
    }

    if (String(projectionTenantId) !== String(context.tenantId)) {
      throw new Error(
        `[SECURITY] Projection has tenantId '${String(projectionTenantId)}' that does not match context tenantId '${String(context.tenantId)}'`,
      );
    }

    // Store in tenant-scoped map
    const tenantIdString = String(context.tenantId);
    let tenantProjections = this.projectionsByTenant.get(tenantIdString);
    if (!tenantProjections) {
      tenantProjections = new Map();
      this.projectionsByTenant.set(tenantIdString, tenantProjections);
    }
    tenantProjections.set(projection.aggregateId, projection);
  }
}


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
export class TraceProjectionStoreMemory implements ProjectionStore {
  private readonly projectionsByTenant = new Map<
    string,
    Map<string, TraceProjection>
  >();

  async getProjection(
    traceId: string,
    context: ProjectionStoreReadContext,
  ): Promise<TraceProjection | null> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "ProjectionStoreMemory.getProjection");

    const tenantProjections = this.projectionsByTenant.get(context.tenantId);
    return tenantProjections?.get(traceId) ?? null;
  }

  async storeProjection(
    projection: TraceProjection,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(
      context,
      "ProjectionStoreMemory.storeProjection",
    );

    // Store in tenant-scoped map
    let tenantProjections = this.projectionsByTenant.get(context.tenantId);
    if (!tenantProjections) {
      tenantProjections = new Map();
      this.projectionsByTenant.set(context.tenantId, tenantProjections);
    }
    tenantProjections.set(projection.aggregateId, projection);
  }
}

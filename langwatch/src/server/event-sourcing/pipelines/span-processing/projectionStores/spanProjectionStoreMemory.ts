import type { Projection, ProjectionStore } from "../../../library";
import type { ProjectionStoreWriteContext } from "../../../library";
import { EventUtils } from "../../../library";

/**
 * No-op projection store for span-processing pipeline.
 * Spans are event-only and don't require projections.
 */
export class SpanProjectionStoreMemory
  implements ProjectionStore<string, Projection<string>>
{
  async getProjection(): Promise<Projection<string> | null> {
    return null;
  }

  async storeProjection(
    projection: Projection<string>,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    // Validate tenant context for security, but don't actually store
    EventUtils.validateTenantId(
      context,
      "SpanProjectionStoreMemory.storeProjection",
    );
    // No-op: spans don't have projections
  }
}


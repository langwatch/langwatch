import type {
  ProjectionStore,
  ProjectionStoreContext,
  ProjectionStoreWriteCtx,
} from "./projectionStore";
import type { TraceProjection } from "../types";

/**
 * In-memory implementation of ProjectionStore for testing/fallback.
 */
export class ProjectionStoreMemory implements ProjectionStore {
  private readonly projections = new Map<string, TraceProjection>();

  async getProjection(
    traceId: string,
    _context?: ProjectionStoreContext
  ): Promise<TraceProjection | null> {
    return this.projections.get(traceId) ?? null;
  }

  async storeProjection(
    projection: TraceProjection,
    _context?: ProjectionStoreWriteCtx
  ): Promise<void> {
    this.projections.set(projection.aggregateId, projection);
  }
}

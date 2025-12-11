import type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { SpanProjection } from "../projections/spanProjection";

/**
 * Interface for span projection storage operations.
 * Stores spans to the ingested_spans ClickHouse table.
 */
export interface SpanProjectionStore extends ProjectionStore<SpanProjection> {
  /**
   * Retrieves a span projection by spanId (aggregateId).
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<SpanProjection | null>;

  /**
   * Stores a span projection to the ingested_spans table.
   */
  storeProjection(
    projection: SpanProjection,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}


import { BaseMemoryProjectionStore } from "../../trace-processing/repositories/baseMemoryRepository";
import type { SpanProjection } from "../projections/spanProjection";
import type { SpanProjectionStore } from "./spanProjectionStore";

/**
 * In-memory implementation of the SpanProjectionStore.
 * Useful for testing and development.
 */
export class SpanProjectionStoreMemory
  extends BaseMemoryProjectionStore<SpanProjection>
  implements SpanProjectionStore
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}


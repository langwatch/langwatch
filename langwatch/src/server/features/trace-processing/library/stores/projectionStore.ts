import type { Projection } from "../core/types";

export interface ProjectionStoreReadContext {
  tenantId?: string;
  metadata?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export type ProjectionStoreWriteContext = ProjectionStoreReadContext;

export interface ProjectionStore<
  AggregateId = string,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>
> {
  getProjection(
    aggregateId: AggregateId,
    context?: ProjectionStoreReadContext
  ): Promise<ProjectionType | null>;
  storeProjection(
    projection: ProjectionType,
    context?: ProjectionStoreWriteContext
  ): Promise<void>;
}


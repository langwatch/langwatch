import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type {
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { Projection } from "../../../library";
import { EventUtils } from "../../../library";
import { createLogger } from "../../../../../utils/logger";
import type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";

/**
 * In-memory projection repository for trace projections.
 * Stores trace metrics matching the trace_projections ClickHouse schema.
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access.
 * Use only for single-threaded environments or with proper synchronization.
 */
export class TraceAggregationStateProjectionRepositoryMemory<
  ProjectionType extends Projection = Projection,
> implements TraceAggregationStateProjectionRepository<ProjectionType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-aggregation-state-projection-repository.memory",
  );
  logger = createLogger(
    "langwatch:trace-aggregation-state-projection-repository:memory",
  );
  // Partition by tenant + traceId
  private readonly projectionsByKey = new Map<string, ProjectionType>();

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    return await this.tracer.withActiveSpan(
      "TraceAggregationStateProjectionRepositoryMemory.getProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        // Validate tenant context
        EventUtils.validateTenantId(
          context,
          "TraceAggregationStateProjectionRepositoryMemory.getProjection",
        );

        const key = `${context.tenantId}:${aggregateId}`;
        const projection = this.projectionsByKey.get(key);
        if (!projection) {
          return null;
        }

        // Deep clone to prevent mutation
        return JSON.parse(JSON.stringify(projection)) as ProjectionType;
      },
    );
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceAggregationStateProjectionRepositoryMemory.storeProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": projection.aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        // Validate tenant context
        EventUtils.validateTenantId(
          context,
          "TraceAggregationStateProjectionRepositoryMemory.storeProjection",
        );

        // Validate projection
        if (!EventUtils.isValidProjection(projection)) {
          throw new Error(
            "[VALIDATION] Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
          );
        }

        // Validate that projection tenantId matches context tenantId
        if (projection.tenantId !== context.tenantId) {
          throw new Error(
            `[SECURITY] Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
          );
        }

        const key = `${context.tenantId}:${projection.aggregateId}`;
        // Deep clone to prevent mutation
        this.projectionsByKey.set(
          key,
          JSON.parse(JSON.stringify(projection)) as ProjectionType,
        );
      },
    );
  }
}

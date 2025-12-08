import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { EventUtils } from "../../../library";
import {
  SecurityError,
  ValidationError,
} from "../../../library/services/errorHandling";
import type { TraceSummaryStateProjectionRepository } from "./traceSummaryStateProjectionRepository";

/**
 * In-memory projection repository for trace summaries.
 * Stores trace metrics matching the trace_summaries ClickHouse schema.
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access.
 * Use only for single-threaded environments or with proper synchronization.
 */
export class TraceSummaryStateProjectionRepositoryMemory<
  ProjectionType extends Projection = Projection,
> implements TraceSummaryStateProjectionRepository<ProjectionType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-summary-state-projection-repository.memory",
  );
  logger = createLogger(
    "langwatch:trace-summary-state-projection-repository:memory",
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
          throw new ValidationError(
            "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
            "projection",
            projection,
          );
        }

        // Validate that projection tenantId matches context tenantId
        if (projection.tenantId !== context.tenantId) {
          throw new SecurityError(
            "storeProjection",
            `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
            projection.tenantId,
            { contextTenantId: context.tenantId },
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

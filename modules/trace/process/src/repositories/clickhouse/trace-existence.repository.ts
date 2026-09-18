/**
 * Set membership over trace_summaries without dedup via TenantId-first predicate.
 */
import { createLogger, type Logger } from "@langwatch/observability";

import { TraceExistenceRepository } from "../read/trace-existence.repository.ts";
import type { TraceClickHouseResolver } from "../trace-clickhouse-client.repository.ts";

export class ClickHouseTraceExistenceRepository extends TraceExistenceRepository {
  static create(options: {
    resolveClient: TraceClickHouseResolver;
  }): ClickHouseTraceExistenceRepository {
    return new ClickHouseTraceExistenceRepository(options.resolveClient);
  }

  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:trace:existence");

  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  async findExistingTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    if (traceIds.length === 0) return [];
    const client = await this.resolveClient(projectId);
    try {
      const result = await client.query<{ TraceId: string }>({
        query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
            `,
        query_params: { tenantId: projectId, traceIds: [...traceIds] },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string }>();
      return rows.map((row) => row.TraceId);
    } catch (error) {
      this.logger.warn(
        {
          projectId,
          traceIdCount: traceIds.length,
          error: error instanceof Error ? error.message : error,
        },
        "Failed to check trace existence in ClickHouse",
      );
      throw new Error("Failed to check which traces exist");
    }
  }
}

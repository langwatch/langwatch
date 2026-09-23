/**
 * Set membership over trace_summaries without dedup via TenantId-first predicate.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import type { TraceUsageCount } from "@langwatch/trace-contract";

import type { TraceClickHouseResolver } from "../trace-clickhouse-client.repository.ts";
import { TraceExistenceRepository } from "../trace-existence.repository.ts";

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

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<TraceUsageCount> {
    const window = (column: string) =>
      since === undefined ? "" : `AND ${column} >= fromUnixTimestamp64Milli({since:Int64})`;
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (projectId) => {
        const client = await this.resolveClient(projectId);
        const count = async (query: string) => {
          const result = await client.query<{ Total: string }>({
            query,
            query_params:
              since === undefined ? { tenantId: projectId } : { tenantId: projectId, since },
            format: "JSONEachRow",
          });
          const [row] = await result.json<{ Total: string }>();
          return Number.parseInt(row?.Total ?? "0", 10);
        };
        const [traces, spans] = await Promise.all([
          count(`
            SELECT toString(count(DISTINCT TraceId)) AS Total
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              ${window("OccurredAt")}`),
          count(`
            SELECT toString(count()) AS Total
            FROM stored_spans
            WHERE TenantId = {tenantId:String}
              ${window("StartTime")}`),
        ]);
        return { traces, spans };
      }),
    );
    return {
      traces: perProject.reduce((sum, row) => sum + row.traces, 0),
      spans: perProject.reduce((sum, row) => sum + row.spans, 0),
    };
  }
}

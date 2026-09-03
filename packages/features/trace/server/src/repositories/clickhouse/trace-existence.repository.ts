/**
 * Set membership over `trace_summaries`, moved out of the application process's
 * `ClickHouseTraceService.findExistingTraceIds` unchanged.
 *
 * No dedup: several unmerged versions of a row all prove the same thing, and
 * the answer is set membership rather than a value. `TenantId` is the first
 * predicate because no other id on this table is unique across tenants.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import type { TraceClickHouseResolver } from "../../ports/clickhouse.port";
import { TraceExistencePort } from "../../ports/trace-existence.port";

export class ClickHouseTraceExistenceRepository extends TraceExistencePort {
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

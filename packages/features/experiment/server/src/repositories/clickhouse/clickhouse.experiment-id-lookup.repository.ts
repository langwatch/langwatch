import type { ExperimentClickHousePort } from "../../ports/experiment-clickhouse.port";
import { ExperimentIdLookupRepository } from "../experiment-id-lookup.repository";

const TABLE_NAME = "experiment_runs" as const;

/**
 * Backs `experimentMetricsSync`'s late-bound lookup (see pipelineRegistry.ts,
 * `registerExperimentRunPipeline`): the trace pipeline knows a `runId` but not the
 * `experimentId` it belongs to, and only `experiment_runs` carries that mapping.
 */
export class ClickHouseExperimentIdLookupRepository extends ExperimentIdLookupRepository {
  private constructor(private readonly clickhouse: ExperimentClickHousePort) {
    super();
  }

  static create(options: {
    clickhouse: ExperimentClickHousePort;
  }): ClickHouseExperimentIdLookupRepository {
    return new ClickHouseExperimentIdLookupRepository(options.clickhouse);
  }

  async findExperimentId({
    tenantId,
    runId,
  }: {
    tenantId: string;
    runId: string;
  }): Promise<string | null> {
    const client = await this.clickhouse.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT ExperimentId
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND RunId = {runId:String}
        ORDER BY UpdatedAt DESC
        LIMIT 1
      `,
      query_params: { tenantId, runId },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ ExperimentId: string }>();
    return rows[0]?.ExperimentId ?? null;
  }
}

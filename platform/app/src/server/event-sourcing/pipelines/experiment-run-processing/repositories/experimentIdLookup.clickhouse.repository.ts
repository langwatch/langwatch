import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

const TABLE_NAME = "experiment_runs" as const;

/** Looks up the experiment a run belongs to, for cross-pipeline wiring. */
export interface ExperimentIdLookup {
  /** The run's ExperimentId, or null if the run has no row yet. */
  findExperimentId(tenantId: string, runId: string): Promise<string | null>;
}

/**
 * Backs `experimentMetricsSync`'s late-bound lookup (see pipelineRegistry.ts,
 * `registerExperimentRunPipeline`): the trace pipeline knows a `runId` but not
 * the `experimentId` it belongs to, and only `experiment_runs` carries that
 * mapping.
 */
export class ExperimentIdLookupClickHouseRepository
  implements ExperimentIdLookup
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findExperimentId(
    tenantId: string,
    runId: string,
  ): Promise<string | null> {
    const client = await this.resolveClient(tenantId);
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

/** No-op lookup for deployments without ClickHouse. */
export class NullExperimentIdLookupRepository implements ExperimentIdLookup {
  async findExperimentId(): Promise<string | null> {
    return null;
  }
}

import type { ExperimentClickHousePort } from "../../ports/experiment-clickhouse.port";

const TABLE_NAME = "experiment_runs" as const;

/** Looks up the experiment a run belongs to, for cross-pipeline wiring. */
export interface ExperimentIdLookup {
  /** The run's ExperimentId, or null if the run has no row yet. */
  findExperimentId(input: { tenantId: string; runId: string }): Promise<string | null>;
}

/**
 * Backs `experimentMetricsSync`'s late-bound lookup (see pipelineRegistry.ts,
 * `registerExperimentRunPipeline`): the trace pipeline knows a `runId` but not
 * the `experimentId` it belongs to, and only `experiment_runs` carries that
 * mapping.
 */
export class ExperimentIdLookupClickHouseRepository implements ExperimentIdLookup {
  constructor(private readonly clickhouse: ExperimentClickHousePort) {}

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

/** No-op lookup for deployments without ClickHouse. */
export class NullExperimentIdLookupRepository implements ExperimentIdLookup {
  // Parameter declared though unused: a caller holding this type still passes
  // it, and a zero-arity signature makes that a type error even though it
  // satisfies the interface.
  async findExperimentId(_input: { tenantId: string; runId: string }): Promise<string | null> {
    return null;
  }
}

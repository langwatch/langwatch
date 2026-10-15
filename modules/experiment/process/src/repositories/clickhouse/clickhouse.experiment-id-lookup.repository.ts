import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import { indexedRead } from "@langwatch/clickhouse-client";

import type { ExperimentClickHouseRepository } from "../experiment-clickhouse.repository.ts";
import { ExperimentIdLookupRepository } from "../experiment-id-lookup.repository.ts";

const TABLE_NAME = "experiment_runs" as const;

/**
 * Backs `experimentMetricsSync`'s late-bound lookup (see pipelineRegistry.ts,
 * `registerExperimentRunPipeline`): the trace pipeline knows a `runId` but not the
 * `experimentId` it belongs to, and only `experiment_runs` carries that mapping.
 */
export class ClickHouseExperimentIdLookupRepository extends ExperimentIdLookupRepository {
  private constructor(
    private readonly clickhouse: ExperimentClickHouseRepository,
    private readonly idIndex: IdIndexFlags | undefined,
  ) {
    super();
  }

  static create(options: {
    clickhouse: ExperimentClickHouseRepository;
    /** The module's id-index readiness; absent reads the run with no time bound, as before. */
    idIndex?: IdIndexFlags | undefined;
  }): ClickHouseExperimentIdLookupRepository {
    return new ClickHouseExperimentIdLookupRepository(options.clickhouse, options.idIndex);
  }

  async findExperimentId({
    tenantId,
    runId,
  }: {
    tenantId: string;
    runId: string;
  }): Promise<string | null> {
    const client = await this.clickhouse.resolveClient(tenantId);
    const rows = await indexedRead<{ ExperimentId: string }[]>({
      client,
      idIndex: this.idIndex,
      tenantId,
      table: TABLE_NAME,
      index: `${TABLE_NAME}_id_index`,
      key: { RunId: runId },
      fallback: "unbounded",
      isEmpty: (found) => found.length === 0,
      run: async (window) => {
        const result = await client.query({
          query: `
            SELECT ExperimentId
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND RunId = {runId:String}
              ${window?.sqlFor("StartedAt") ?? ""}
            ORDER BY UpdatedAt DESC
            LIMIT 1
          `,
          query_params: { tenantId, runId, ...window?.params },
          format: "JSONEachRow",
        });
        return result.json<{ ExperimentId: string }>();
      },
    });
    return rows[0]?.ExperimentId ?? null;
  }
}

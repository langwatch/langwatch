import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";

import type { ExperimentClickHouseRepository } from "../experiment-clickhouse.repository.ts";
import { ExperimentIdLookupRepository } from "../experiment-id-lookup.repository.ts";
import { experimentRuns as runs } from "./clickhouse.experiment-runs.table.ts";

/**
 * Backs `experimentMetricsSync`'s late-bound lookup (see pipelineRegistry.ts,
 * `registerExperimentRunPipeline`): the trace pipeline knows a `runId` but not the
 * `experimentId` it belongs to, and only `experiment_runs` carries that mapping.
 */
export class ClickHouseExperimentIdLookupRepository extends ExperimentIdLookupRepository {
  private constructor(private readonly clickhouse: ExperimentClickHouseRepository) {
    super();
  }

  static create(options: {
    clickhouse: ExperimentClickHouseRepository;
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
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(runs)
      .select({ ExperimentId: runs.ExperimentId })
      .where(({ idBound }) => idBound(runs.RunId, runId))
      .orderBy(runs.UpdatedAt, "DESC")
      .limit(1)
      .build();
    const { rows } = await client.read({ statement, idBound: { fallback: "unbounded" } });
    return rows[0]?.ExperimentId ?? null;
  }
}

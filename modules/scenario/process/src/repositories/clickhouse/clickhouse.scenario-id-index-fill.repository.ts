import {
  type ClickHouseQueryClient,
  type FillIdIndexesOptions,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
} from "@langwatch/clickhouse-client";

import { ScenarioIdIndexFillRepository } from "../scenario-id-index-fill.repository.ts";

/**
 * The id index goose `00115` creates. `simulation_runs` expires on its partition column
 * `StartedAt` and carries `_retention_days`, so the fill copies the one and needs no `RetainAt`.
 */
export const SCENARIO_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "simulation_runs",
    index: "simulation_runs_id_index",
    key: ["ScenarioRunId"],
    time: "StartedAt",
    retentionAnchor: "StartedAt",
    retention: "copied",
  },
];

/** Fills the id indexes on the shared server and every private one, through the routed client. */
export class ScenarioIdIndexFillClickHouseRepository extends ScenarioIdIndexFillRepository {
  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ScenarioIdIndexFillClickHouseRepository {
    return new ScenarioIdIndexFillClickHouseRepository(clickhouse);
  }

  readonly indexes = SCENARIO_ID_INDEXES;

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport> {
    return fillIdIndexes({
      ...input,
      indexes: this.indexes,
      statements: this.clickhouse,
      targets: idIndexFillTargets({ privateRoutes: this.clickhouse.privateRoutes() }),
    });
  }
}

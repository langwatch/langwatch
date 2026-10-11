import {
  type ClickHouseQueryClient,
  type FillIdIndexesOptions,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
} from "@langwatch/clickhouse-client";

import { SuiteIdIndexFillRepository } from "../suite-id-index-fill.repository.ts";

/**
 * The id index goose `00116` creates. `suite_runs` expires on its partition column `StartedAt`
 * and carries `_retention_days`, so the fill copies the one and needs no `RetainAt`.
 */
export const SUITE_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "suite_runs",
    index: "suite_runs_id_index",
    key: ["BatchRunId"],
    time: "StartedAt",
    retentionAnchor: "StartedAt",
    retention: "copied",
  },
];

/** Fills the id indexes on the shared server and every private one, through the routed client. */
export class SuiteIdIndexFillClickHouseRepository extends SuiteIdIndexFillRepository {
  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): SuiteIdIndexFillClickHouseRepository {
    return new SuiteIdIndexFillClickHouseRepository(clickhouse);
  }

  readonly indexes = SUITE_ID_INDEXES;

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

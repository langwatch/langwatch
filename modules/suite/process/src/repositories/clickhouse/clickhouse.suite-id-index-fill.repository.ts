import {
  type ClickHouseQueryClient,
  fillOwnerIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  type IdIndexOwnerFill,
  IdIndexReadiness,
  idIndexReadinessTargets,
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

  readonly readiness: IdIndexReadiness;

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
    this.readiness = IdIndexReadiness.create({
      statements: clickhouse,
      indexes: SUITE_ID_INDEXES,
      watch: () => idIndexReadinessTargets({ privateRoutes: clickhouse.privateRoutes() }),
    });
  }

  fill(input: IdIndexOwnerFill): Promise<IdIndexFillReport> {
    return fillOwnerIdIndexes({ ...input, clickhouse: this.clickhouse, indexes: SUITE_ID_INDEXES });
  }
}

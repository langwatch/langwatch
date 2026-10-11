import {
  type ClickHouseQueryClient,
  fillOwnerIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  type IdIndexOwnerFill,
  IdIndexReadiness,
  idIndexReadinessTargets,
} from "@langwatch/clickhouse-client";

import { ExperimentIdIndexFillRepository } from "../experiment-id-index-fill.repository.ts";

/**
 * The id indexes goose `00114` creates, in the order the fill visits them. Each source carries
 * its row's `_retention_days` and expires on its partition column, so the fill copies the one
 * and needs no `RetainAt`.
 */
export const EXPERIMENT_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "experiment_runs",
    index: "experiment_runs_id_index",
    key: ["RunId"],
    time: "StartedAt",
    retentionAnchor: "StartedAt",
    retention: "copied",
  },
  {
    source: "dspy_steps",
    index: "dspy_steps_id_index",
    key: ["ExperimentId", "RunId"],
    time: "CreatedAt",
    retentionAnchor: "CreatedAt",
    retention: "copied",
  },
];

/** Fills the id indexes on the shared server and every private one, through the routed client. */
export class ExperimentIdIndexFillClickHouseRepository extends ExperimentIdIndexFillRepository {
  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ExperimentIdIndexFillClickHouseRepository {
    return new ExperimentIdIndexFillClickHouseRepository(clickhouse);
  }

  readonly readiness: IdIndexReadiness;

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
    this.readiness = IdIndexReadiness.create({
      statements: clickhouse,
      indexes: EXPERIMENT_ID_INDEXES,
      watch: () => idIndexReadinessTargets({ privateRoutes: clickhouse.privateRoutes() }),
    });
  }

  fill(input: IdIndexOwnerFill): Promise<IdIndexFillReport> {
    return fillOwnerIdIndexes({
      ...input,
      clickhouse: this.clickhouse,
      indexes: EXPERIMENT_ID_INDEXES,
    });
  }
}

import {
  type ClickHouseQueryClient,
  type FillIdIndexesOptions,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
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

  readonly indexes = EXPERIMENT_ID_INDEXES;

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

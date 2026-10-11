import type {
  AnalyticsEvaluationReadInput,
  AnalyticsEvaluationRollupAppendBatchInput,
  AnalyticsEvaluationRollupAppendInput,
  AnalyticsEvaluationRow,
  AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

/** What a fill of Analytics' id indexes takes; the repository supplies its own statements. */
export type AnalyticsIdIndexFill = Omit<
  FillIdIndexesOptions,
  "statements" | "targets" | "indexes" | "beforeFlag"
> & {
  /** Runs once a target is filled, before its flags, with the index tables retention copies to. */
  beforeFlag: (input: {
    target: Parameters<FillIdIndexesOptions["beforeFlag"]>[0]["target"];
    indexes: readonly string[];
  }) => Promise<void>;
};

/** Private Analytics persistence boundary for the evaluation analytics tables. */
export abstract class AnalyticsEvaluationRepository {
  abstract upsert(input: AnalyticsEvaluationUpsertInput): Promise<void>;
  abstract upsertBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void>;
  abstract findLatest(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] }[]>;
  abstract appendRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void>;
  abstract appendRollupBatch(input: AnalyticsEvaluationRollupAppendBatchInput): Promise<void>;
  /** Fills the evaluation id index from rows older than its view, on every ClickHouse target. */
  abstract fillIdIndexes(input: AnalyticsIdIndexFill): Promise<IdIndexFillReport>;
}

/** What a fill reports where there is no ClickHouse to fill: nothing visited, nothing owed. */
export const EMPTY_ID_INDEX_FILL_REPORT: IdIndexFillReport = {
  targetsDone: [],
  targetsFailed: [],
  cursor: null,
  done: 0,
  total: 0,
  batches: 0,
  retries: 0,
};

/** ClickHouse-disabled processes keep evaluation projections as durable no-ops. */
export class NullAnalyticsEvaluationRepository extends AnalyticsEvaluationRepository {
  static create(): NullAnalyticsEvaluationRepository {
    return new NullAnalyticsEvaluationRepository();
  }

  private constructor() {
    super();
  }

  async upsert(_input: AnalyticsEvaluationUpsertInput): Promise<void> {}

  async upsertBatch(_input: AnalyticsEvaluationUpsertInput[]): Promise<void> {}

  async findLatest(
    _input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] }[]> {
    return [];
  }

  async appendRollup(_input: AnalyticsEvaluationRollupAppendInput): Promise<void> {}

  async appendRollupBatch(_input: AnalyticsEvaluationRollupAppendBatchInput): Promise<void> {}

  async fillIdIndexes(_input: AnalyticsIdIndexFill): Promise<IdIndexFillReport> {
    return { ...EMPTY_ID_INDEX_FILL_REPORT };
  }
}

import type {
  AnalyticsEvaluationReadInput,
  AnalyticsEvaluationRollupAppendBatchInput,
  AnalyticsEvaluationRollupAppendInput,
  AnalyticsEvaluationRow,
  AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";

/** Private Analytics persistence boundary for the evaluation analytics tables. */
export abstract class AnalyticsEvaluationRepository {
  abstract upsert(input: AnalyticsEvaluationUpsertInput): Promise<void>;
  abstract upsertBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void>;
  abstract findLatest(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] }[]>;
  abstract appendRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void>;
  abstract appendRollupBatch(input: AnalyticsEvaluationRollupAppendBatchInput): Promise<void>;
}

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
}

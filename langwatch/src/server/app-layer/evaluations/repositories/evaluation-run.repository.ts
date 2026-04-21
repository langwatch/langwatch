import type { EvalSummary, EvaluationRunData } from "../types";

/**
 * Optional hints used to enable ClickHouse partition pruning. The
 * `evaluation_runs` table is partitioned by `toYearWeek(ScheduledAt)`; when
 * the caller knows roughly when the evaluation was scheduled, passing a tight
 * range here lets the engine skip every other weekly partition and avoid
 * cold-storage scans.
 */
export interface GetByEvaluationIdHints {
  scheduledAt?: Date;
  /**
   * How far either side of `scheduledAt` to scan. Defaults to ±7 days, which
   * comfortably covers the typical eval lifetime (schedule → run → archive).
   */
  scheduledAtSlackMs?: number;
}

export interface GetByEvaluationIdParams {
  tenantId: string;
  evaluationId: string;
  hints?: GetByEvaluationIdHints;
}

export interface EvaluationRunRepository {
  upsert(data: EvaluationRunData, tenantId: string): Promise<void>;
  upsertBatch?(entries: Array<{ data: EvaluationRunData; tenantId: string }>): Promise<void>;
  getByEvaluationId(params: GetByEvaluationIdParams): Promise<EvaluationRunData | null>;
  findByTraceId(
    tenantId: string,
    evaluationId: string,
  ): Promise<EvaluationRunData | null>;
  findByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<EvaluationRunData[]>;
}

export class NullEvaluationRunRepository implements EvaluationRunRepository {
  async upsert(_data: EvaluationRunData, _tenantId: string): Promise<void> {}

  async getByEvaluationId(
    _params: GetByEvaluationIdParams,
  ): Promise<EvaluationRunData | null> {
    return null;
  }

  async findByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<EvaluationRunData[]> {
    return [];
  }
}

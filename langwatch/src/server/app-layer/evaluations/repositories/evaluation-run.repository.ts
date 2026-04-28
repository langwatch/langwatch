import type { EvalSummary, EvaluationRunData } from "../types";

export interface EvaluationRunRepository {
  upsert(data: EvaluationRunData, tenantId: string): Promise<void>;
  upsertBatch?(entries: Array<{ data: EvaluationRunData; tenantId: string }>): Promise<void>;
  getByEvaluationId(
    tenantId: string,
    evaluationId: string,
  ): Promise<EvaluationRunData | null>;
  findByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<EvaluationRunData[]>;
  findSummariesByTraceIds(
    tenantId: string,
    traceIds: string[],
    since: number,
  ): Promise<Record<string, EvalSummary[]>>;
}

export class NullEvaluationRunRepository implements EvaluationRunRepository {
  async upsert(_data: EvaluationRunData, _tenantId: string): Promise<void> {}

  async getByEvaluationId(
    _tenantId: string,
    _evaluationId: string,
  ): Promise<EvaluationRunData | null> {
    return null;
  }

  async findByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<EvaluationRunData[]> {
    return [];
  }

  async findSummariesByTraceIds(
    _tenantId: string,
    _traceIds: string[],
    _since: number,
  ): Promise<Record<string, EvalSummary[]>> {
    return {};
  }
}

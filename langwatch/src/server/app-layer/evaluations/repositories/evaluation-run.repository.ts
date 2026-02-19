import type { EvaluationRunData } from "../types";

export interface EvaluationRunRepository {
  upsert(data: EvaluationRunData, tenantId: string): Promise<void>;
  getByEvaluationId(
    tenantId: string,
    evaluationId: string,
  ): Promise<EvaluationRunData | null>;
}

export class NullEvaluationRunRepository implements EvaluationRunRepository {
  async upsert(_data: EvaluationRunData, _tenantId: string): Promise<void> {}

  async getByEvaluationId(
    _tenantId: string,
    _evaluationId: string,
  ): Promise<EvaluationRunData | null> {
    return null;
  }
}

import type { AnalyticsEvaluationFactData } from "../types";

export interface AnalyticsEvaluationFactsRepository {
  upsert(data: AnalyticsEvaluationFactData, tenantId: string): Promise<void>;
  getByEvaluationId(
    tenantId: string,
    evaluationId: string,
  ): Promise<AnalyticsEvaluationFactData | null>;
}

export class NullAnalyticsEvaluationFactsRepository
  implements AnalyticsEvaluationFactsRepository
{
  async upsert(
    _data: AnalyticsEvaluationFactData,
    _tenantId: string,
  ): Promise<void> {}

  async getByEvaluationId(
    _tenantId: string,
    _evaluationId: string,
  ): Promise<AnalyticsEvaluationFactData | null> {
    return null;
  }
}

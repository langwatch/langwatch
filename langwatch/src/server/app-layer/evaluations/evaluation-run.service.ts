import { EvaluationNotFoundError } from "./errors";
import type { EvaluationRunRepository } from "./repositories/evaluation-run.repository";
import type { EvalSummary, EvaluationRunData } from "./types";

export class EvaluationRunService {
  constructor(readonly repository: EvaluationRunRepository) {}

  async upsert(data: EvaluationRunData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByEvaluationId(
    tenantId: string,
    evaluationId: string,
  ): Promise<EvaluationRunData> {
    const result = await this.repository.getByEvaluationId(tenantId, evaluationId);
    if (!result) throw new EvaluationNotFoundError(evaluationId);
    return result;
  }

  async findByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<EvaluationRunData[]> {
    return this.repository.findByTraceId(tenantId, traceId);
  }

  async findSummariesByTraceIds(
    tenantId: string,
    traceIds: string[],
  ): Promise<Record<string, EvalSummary[]>> {
    return this.repository.findSummariesByTraceIds(tenantId, traceIds);
  }
}

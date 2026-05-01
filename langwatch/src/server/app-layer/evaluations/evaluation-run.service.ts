import { EvaluationNotFoundError } from "./errors";
import type { EvaluationRunRepository, GetByEvaluationIdHints } from "./repositories/evaluation-run.repository";
import type { EvalSummary, EvaluationRunData } from "./types";

export class EvaluationRunService {
  constructor(readonly repository: EvaluationRunRepository) {}

  async upsert(data: EvaluationRunData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByEvaluationId(
    tenantId: string,
    evaluationId: string,
    hints?: GetByEvaluationIdHints,
  ): Promise<EvaluationRunData> {
    const result = await this.repository.getByEvaluationId(tenantId, evaluationId, hints);
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
    since: number,
  ): Promise<Record<string, EvalSummary[]>> {
    return this.repository.findSummariesByTraceIds(tenantId, traceIds, since);
  }
}

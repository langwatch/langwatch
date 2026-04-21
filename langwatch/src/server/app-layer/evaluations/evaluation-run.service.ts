import { EvaluationNotFoundError } from "./errors";
import type {
  EvaluationRunRepository,
  GetByEvaluationIdParams,
} from "./repositories/evaluation-run.repository";
import type { EvalSummary, EvaluationRunData } from "./types";

export class EvaluationRunService {
  constructor(readonly repository: EvaluationRunRepository) {}

  async upsert(data: EvaluationRunData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByEvaluationId(
    params: GetByEvaluationIdParams,
  ): Promise<EvaluationRunData> {
    const result = await this.repository.getByEvaluationId(params);
    if (!result) throw new EvaluationNotFoundError(params.evaluationId);
    return result;
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<EvaluationRunData[]> {
    return this.repository.findByTraceId(tenantId, traceId);
  }
}

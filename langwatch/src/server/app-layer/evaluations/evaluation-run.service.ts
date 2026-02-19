import type { ClickHouseClient } from "@clickhouse/client";
import { EvaluationNotFoundError } from "./errors";
import { traced } from "../tracing";
import { EvaluationRunClickHouseRepository } from "./repositories/evaluation-run.clickhouse.repository";
import {
  NullEvaluationRunRepository,
  type EvaluationRunRepository,
} from "./repositories/evaluation-run.repository";
import type { EvaluationRunData } from "./types";

export class EvaluationRunService {
  constructor(readonly repository: EvaluationRunRepository) {}

  static create(clickhouse: ClickHouseClient | null): EvaluationRunService {
    const repo = clickhouse
      ? new EvaluationRunClickHouseRepository(clickhouse)
      : new NullEvaluationRunRepository();
    return traced(new EvaluationRunService(repo), "EvaluationRunService");
  }

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
}

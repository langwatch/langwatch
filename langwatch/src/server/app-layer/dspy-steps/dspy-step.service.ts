import type { ClickHouseClient } from "@clickhouse/client";
import { traced } from "../tracing";
import type { DspyStepData, DspyStepSummaryData } from "./types";
import { DspyStepNotFoundError } from "./errors";
import { DspyStepClickHouseRepository } from "./repositories/dspy-step.clickhouse.repository";
import {
  NullDspyStepRepository,
  type DspyStepRepository,
} from "./repositories/dspy-step.repository";

export class DspyStepService {
  constructor(readonly repository: DspyStepRepository) {}

  static create(clickhouse: ClickHouseClient | null): DspyStepService {
    const repo = clickhouse
      ? new DspyStepClickHouseRepository(clickhouse)
      : new NullDspyStepRepository();
    return traced(new DspyStepService(repo), "DspyStepService");
  }

  async upsertStep(data: DspyStepData): Promise<void> {
    await this.repository.upsertStep(data);
  }

  async getStepsByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<DspyStepSummaryData[]> {
    return this.repository.getStepsByExperiment(tenantId, experimentId);
  }

  async getStep(
    tenantId: string,
    experimentId: string,
    runId: string,
    stepIndex: string,
  ): Promise<DspyStepData> {
    const result = await this.repository.getStep(
      tenantId,
      experimentId,
      runId,
      stepIndex,
    );
    if (!result) {
      throw new DspyStepNotFoundError(
        `${tenantId}/${experimentId}/${runId}/${stepIndex}`,
      );
    }
    return result;
  }

  async deleteByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<void> {
    await this.repository.deleteByExperiment(tenantId, experimentId);
  }
}

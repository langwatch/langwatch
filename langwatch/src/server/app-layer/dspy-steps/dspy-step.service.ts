import type { DspyStepData, DspyStepSummaryData } from "./types";
import { DspyStepNotFoundError } from "./errors";
import type { DspyStepRepository } from "./repositories/dspy-step.repository";

export class DspyStepService {
  constructor(readonly repository: DspyStepRepository) {}

  async upsertStep(data: DspyStepData): Promise<void> {
    await this.repository.upsertStep(data);
  }

  async getStepsByExperiment({
    tenantId,
    experimentId,
  }: {
    tenantId: string;
    experimentId: string;
  }): Promise<DspyStepSummaryData[]> {
    return this.repository.getStepsByExperiment(tenantId, experimentId);
  }

  async getStep({
    tenantId,
    experimentId,
    runId,
    stepIndex,
  }: {
    tenantId: string;
    experimentId: string;
    runId: string;
    stepIndex: string;
  }): Promise<DspyStepData> {
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

  async deleteByExperiment({
    tenantId,
    experimentId,
  }: {
    tenantId: string;
    experimentId: string;
  }): Promise<void> {
    await this.repository.deleteByExperiment(tenantId, experimentId);
  }
}

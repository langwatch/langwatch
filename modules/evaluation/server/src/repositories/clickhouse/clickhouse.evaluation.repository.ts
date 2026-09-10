import type { WorkflowApi } from "@langwatch/workflow-contract";
import {
  EvaluationExecution,
  EvaluationInputsResolution,
  type EvaluationRetentionFloor,
} from "../../app/evaluation.members.ts";
import type { EvaluationClickHouseResolver } from "./evaluation-clickhouse-client.ts";
import { ClickHouseEvaluationRepository } from "./evaluation.repository.ts";
import { ClickHouseMonitorPerformanceRepository } from "./monitor-performance.repository.ts";
import { EvaluationService } from "../../services/evaluation.service.ts";

export type EvaluationAdapterOptions = {
  resolveClickHouse: EvaluationClickHouseResolver;
  retentionFloor: EvaluationRetentionFloor;
  execution: EvaluationExecution;
  inputResolution?: EvaluationInputsResolution;
  workflows: WorkflowApi;
};

class PassthroughEvaluationInputsResolution implements EvaluationInputsResolution {
  async tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    return input.inputs;
  }
}

/** Composes one Evaluation service from ClickHouse and canonical capabilities. */
export class ClickhouseEvaluationRepository {
  static create(options: EvaluationAdapterOptions): EvaluationService {
    return EvaluationService.create({
      repository: ClickHouseEvaluationRepository.create({
        resolveClient: options.resolveClickHouse,
        retentionFloor: options.retentionFloor,
      }),
      monitorPerformance: ClickHouseMonitorPerformanceRepository.create({
        resolveClient: options.resolveClickHouse,
      }),
      execution: options.execution,
      inputResolution: options.inputResolution ?? new PassthroughEvaluationInputsResolution(),
      workflows: options.workflows,
    });
  }
}

import type { WorkflowApi } from "@langwatch/workflow-contract";
import {
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
  type EvaluationClickHouseResolver,
  type EvaluationRetentionFloorPort,
} from "../../ports/evaluation.port.ts";
import { ClickHouseEvaluationRepository } from "./evaluation.repository.ts";
import { ClickHouseMonitorPerformanceRepository } from "./monitor-performance.repository.ts";
import { EvaluationService } from "../../services/evaluation.service.ts";

export type EvaluationAdapterOptions = {
  resolveClickHouse: EvaluationClickHouseResolver;
  retentionFloor: EvaluationRetentionFloorPort;
  execution: EvaluationExecutionPort;
  inputResolution?: EvaluationInputsResolutionPort;
  workflows: WorkflowApi;
};

class PassthroughEvaluationInputsResolution extends EvaluationInputsResolutionPort {
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

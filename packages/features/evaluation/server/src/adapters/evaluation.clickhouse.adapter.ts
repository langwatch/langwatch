import type { WorkflowService } from "@langwatch/workflow-contract";
import type { EvaluationService as EvaluationServiceContract } from "@langwatch/evaluation-contract";
import {
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
  type EvaluationClickHouseResolver,
  type EvaluationRetentionFloorPort,
} from "../ports/evaluation.port";
import { ClickHouseEvaluationRepository } from "../repositories/clickhouse/evaluation.repository";
import { ClickHouseMonitorPerformanceRepository } from "../repositories/clickhouse/monitor-performance.repository";
import { EvaluationService } from "../services/evaluation.service";

export type EvaluationAdapterOptions = {
  resolveClickHouse: EvaluationClickHouseResolver;
  retentionFloor: EvaluationRetentionFloorPort;
  execution: EvaluationExecutionPort;
  inputResolution?: EvaluationInputsResolutionPort;
  workflows: WorkflowService;
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
export class EvaluationAdapter {
  static create(options: EvaluationAdapterOptions): EvaluationServiceContract {
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

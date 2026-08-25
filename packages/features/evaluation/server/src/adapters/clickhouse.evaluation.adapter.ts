import type { WorkflowService } from "@langwatch/workflow-contract";
import type { EvaluationService as EvaluationServiceContract } from "@langwatch/evaluation-contract";
import {
  EvaluationExecutionPort,
  type EvaluationClickHouseResolver,
  type EvaluationRetentionFloorPort,
} from "../ports/evaluation.port";
import { ClickHouseEvaluationRepository } from "../repositories/clickhouse/clickhouse.evaluation.repository";
import { ClickHouseMonitorPerformanceRepository } from "../repositories/clickhouse/clickhouse.monitor-performance.repository";
import { EvaluationService } from "../services/evaluation.service";

export type EvaluationAdapterOptions = {
  resolveClickHouse: EvaluationClickHouseResolver;
  retentionFloor: EvaluationRetentionFloorPort;
  execution: EvaluationExecutionPort;
  workflows: WorkflowService;
};

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
      workflows: options.workflows,
    });
  }
}

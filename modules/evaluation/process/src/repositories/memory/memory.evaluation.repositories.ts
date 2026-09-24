import type { EvaluationRepositories } from "../evaluation.repositories.ts";
import { MemoryEvaluationCostRepository } from "./memory.evaluation-cost.repository.ts";
import { MemoryEvaluationRunRepository } from "./memory.evaluation-run.repository.ts";
import { MemoryMonitorPerformanceRepository } from "./memory.monitor-performance.repository.ts";

export class MemoryEvaluationRepositories {
  static readonly requires = [] as const;

  static create(): EvaluationRepositories {
    return {
      costs: MemoryEvaluationCostRepository.create(),
      runs: MemoryEvaluationRunRepository.create(),
      monitorPerformance: MemoryMonitorPerformanceRepository.create(),
    };
  }
}

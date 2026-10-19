import type { FoldProjectionStore } from "@langwatch/eventing";
import { memoryObjectStorage } from "@langwatch/process-stores";

import type { EvaluationAnalyticsFoldCacheRepository } from "../evaluation-analytics-fold-cache.repository.ts";
import type { EvaluationRepositories } from "../evaluation.repositories.ts";
import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
} from "../monitor-performance.repository.ts";
import { ObjectStorageEvaluationLangevalsStagingRepository } from "../object-storage/object-storage.evaluation-langevals-staging.repository.ts";
import { MemoryEvaluationCostRepository } from "./memory.evaluation-cost.repository.ts";
import { MemoryEvaluationInputRepository } from "./memory.evaluation-input.repository.ts";
import { MemoryEvaluationRunRepository } from "./memory.evaluation-run.repository.ts";

/** The trend over no traces: nothing in this module writes the rows it folds. */
class MemoryMonitorPerformanceRepository extends MonitorPerformanceRepository {
  static create(): MemoryMonitorPerformanceRepository {
    return new MemoryMonitorPerformanceRepository();
  }

  private constructor() {
    super();
  }

  async findBuckets(): Promise<MonitorPerformanceBucket[]> {
    return [];
  }
}

/** No cache tier in memory: the durable store is already as fast as a cache. */
export class MemoryEvaluationAnalyticsFoldCacheRepository implements EvaluationAnalyticsFoldCacheRepository {
  private constructor() {}

  static create(): MemoryEvaluationAnalyticsFoldCacheRepository {
    return new MemoryEvaluationAnalyticsFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}

export class MemoryEvaluationRepositories {
  static readonly requires = [] as const;

  static create(): EvaluationRepositories {
    return {
      costs: MemoryEvaluationCostRepository.create(),
      runs: MemoryEvaluationRunRepository.create(),
      monitorPerformance: MemoryMonitorPerformanceRepository.create(),
      analyticsFoldCache: MemoryEvaluationAnalyticsFoldCacheRepository.create(),
      inputs: MemoryEvaluationInputRepository.create(),
      langevalsStaging: ObjectStorageEvaluationLangevalsStagingRepository.create({
        objectStorage: memoryObjectStorage(),
      }),
    };
  }
}

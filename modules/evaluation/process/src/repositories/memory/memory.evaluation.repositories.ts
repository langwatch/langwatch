import type { FoldProjectionStore } from "@langwatch/eventing";
import { memoryObjectStorage } from "@langwatch/process-stores";

import { evaluatorErrorCodeOf } from "../../rules/evaluator-error-code.rules.ts";
import type { EvaluationAnalyticsFoldCacheRepository } from "../evaluation-analytics-fold-cache.repository.ts";
import type { EvaluationRepositories } from "../evaluation.repositories.ts";
import {
  MonitorPerformanceRepository,
  type EvaluatorOutcomeRow,
  type EvaluatorOutcomeRowQuery,
  type EvaluatorTypeUsageRow,
  type EvaluatorTypeUsageRowQuery,
  type MonitorPerformanceBucket,
} from "../monitor-performance.repository.ts";
import { ObjectStorageEvaluationLangevalsStagingRepository } from "../object-storage/object-storage.evaluation-langevals-staging.repository.ts";
import { MemoryEvaluationCostRepository } from "./memory.evaluation-cost.repository.ts";
import { MemoryEvaluationInputRepository } from "./memory.evaluation-input.repository.ts";
import { MemoryEvaluationRunRepository } from "./memory.evaluation-run.repository.ts";
import { MemoryMonitorErrorRateRepository } from "./memory.monitor-error-rate.repository.ts";

/** The trend over no traces; outcome counts fold over the memory runs. */
class MemoryMonitorPerformanceRepository extends MonitorPerformanceRepository {
  static create({
    runs,
  }: {
    runs: MemoryEvaluationRunRepository;
  }): MemoryMonitorPerformanceRepository {
    return new MemoryMonitorPerformanceRepository(runs);
  }

  private constructor(private readonly runs: MemoryEvaluationRunRepository) {
    super();
  }

  async findBuckets(): Promise<MonitorPerformanceBucket[]> {
    return [];
  }

  async findOutcomeRows(input: EvaluatorOutcomeRowQuery): Promise<EvaluatorOutcomeRow[]> {
    const rows = new Map<string, EvaluatorOutcomeRow>();
    for (const run of this.runs.findTenantRuns({ tenantId: input.tenantId })) {
      const scheduledAt = run.scheduledAt ?? run.createdAt;
      if (scheduledAt < input.since || scheduledAt >= input.until) continue;
      const isError = run.status === "error";
      const errorCode = isError ? evaluatorErrorCodeOf(run.error) : "";
      const key = `${run.evaluatorId}\u0000${errorCode}`;
      const row = rows.get(key) ?? {
        evaluatorId: run.evaluatorId,
        evaluatorType: run.evaluatorType,
        errorCode,
        runs: 0,
        errors: 0,
        skipped: 0,
        lastErrorAt: null,
      };
      row.runs += 1;
      if (run.status === "skipped") row.skipped += 1;
      if (isError) {
        row.errors += 1;
        const settledAt = run.completedAt ?? run.updatedAt;
        row.lastErrorAt = Math.max(row.lastErrorAt ?? 0, settledAt);
      }
      rows.set(key, row);
    }
    return [...rows.values()].slice(0, input.limit);
  }

  async findTypeUsageRows(input: EvaluatorTypeUsageRowQuery): Promise<EvaluatorTypeUsageRow[]> {
    const rows = new Map<string, EvaluatorTypeUsageRow & { tenants: Set<string> }>();
    for (const { tenantId, run } of this.runs.findEveryRun()) {
      const scheduledAt = run.scheduledAt ?? run.createdAt;
      if (scheduledAt < input.since || scheduledAt >= input.until) continue;
      const row = rows.get(run.evaluatorType) ?? {
        evaluatorType: run.evaluatorType,
        projects: 0,
        runs: 0,
        errors: 0,
        skipped: 0,
        errorsByCode: {},
        tenants: new Set<string>(),
      };
      row.tenants.add(tenantId);
      row.runs += 1;
      if (run.status === "skipped") row.skipped += 1;
      if (run.status === "error") {
        row.errors += 1;
        const code = evaluatorErrorCodeOf(run.error);
        row.errorsByCode[code] = (row.errorsByCode[code] ?? 0) + 1;
      }
      rows.set(run.evaluatorType, row);
    }
    return [...rows.values()]
      .map(({ tenants, ...row }) => ({ ...row, projects: tenants.size }))
      .toSorted((a, b) => b.runs - a.runs || a.evaluatorType.localeCompare(b.evaluatorType))
      .slice(0, input.limit);
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
    const runs = MemoryEvaluationRunRepository.create();
    return {
      costs: MemoryEvaluationCostRepository.create(),
      runs,
      monitorPerformance: MemoryMonitorPerformanceRepository.create({ runs }),
      analyticsFoldCache: MemoryEvaluationAnalyticsFoldCacheRepository.create(),
      monitorErrorRates: MemoryMonitorErrorRateRepository.create(),
      inputs: MemoryEvaluationInputRepository.create(),
      langevalsStaging: ObjectStorageEvaluationLangevalsStagingRepository.create({
        objectStorage: memoryObjectStorage(),
      }),
    };
  }
}

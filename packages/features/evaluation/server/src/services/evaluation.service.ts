import {
  EvaluationNotFoundError,
  EvaluationService as EvaluationServiceContract,
  evaluationInputsQuerySchema,
  evaluationRunDataSchema,
  evaluationRunLookupSchema,
  evaluationRunsByTraceQuerySchema,
  evaluationExecutionResultSchema,
  monitorPerformanceQuerySchema,
  onlineEvaluationPerformanceSchema,
  evaluationSummariesByTraceIdsQuerySchema,
  traceEvaluationsQuerySchema,
  executeEvaluationCommandSchema,
  upsertEvaluationRunCommandSchema,
  type EvaluationExecutionResult,
  type EvaluationRunData,
  type EvaluationSummary,
  type MonitorPerformanceQuery,
  type OnlineEvaluationPerformance,
  type TraceEvaluationData,
  type ExecuteEvaluationCommand,
  type UpsertEvaluationRunCommand,
} from "@langwatch/evaluation-contract";
import type {
  EvaluationExecutionPort,
  EvaluationFeatureDependencies,
  EvaluationInputsResolutionPort,
} from "../ports/evaluation.port";
import type {
  MonitorPerformanceBucket,
  MonitorPerformanceRepository,
} from "../repositories/monitor-performance.repository";
import type { EvaluationRunRepository } from "../repositories/evaluation.repository";

export type EvaluationServiceOptions = {
  repository: EvaluationRunRepository;
  monitorPerformance: MonitorPerformanceRepository;
  execution: EvaluationExecutionPort;
  inputResolution: EvaluationInputsResolutionPort;
  workflows: EvaluationFeatureDependencies["workflows"];
};

/** One canonical Evaluation capability for API, workers and projections. */
export class EvaluationService extends EvaluationServiceContract {
  static create(options: EvaluationServiceOptions): EvaluationService {
    return new EvaluationService(options);
  }

  private constructor(private readonly options: EvaluationServiceOptions) {
    super();
  }

  async executeForTrace(
    input: ExecuteEvaluationCommand,
  ): Promise<EvaluationExecutionResult> {
    const command = executeEvaluationCommandSchema.parse(input);
    if (command.workflowId) {
      await this.options.workflows.assertInProject({
        workflowId: command.workflowId,
        projectId: command.projectId,
      });
    }
    return evaluationExecutionResultSchema.parse(
      await this.options.execution.execute(command),
    );
  }

  async upsertRun(input: UpsertEvaluationRunCommand): Promise<void> {
    const command = upsertEvaluationRunCommandSchema.parse(input);
    const data = evaluationRunDataSchema.parse(command.data);
    await this.options.repository.upsert({
      data,
      tenantId: command.tenantId,
      retentionDays: command.retentionDays,
    });
  }

  async upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void> {
    const commands = input.map((entry) => upsertEvaluationRunCommandSchema.parse(entry));
    await this.options.repository.upsertBatch(
      commands.map((command) => ({
        data: evaluationRunDataSchema.parse(command.data),
        tenantId: command.tenantId,
        retentionDays: command.retentionDays,
      })),
    );
  }

  async getRunByEvaluationId(input: {
    tenantId: string;
    evaluationId: string;
    scheduledAt?: Date;
    scheduledAtSlackMs?: number;
  }): Promise<EvaluationRunData> {
    const query = evaluationRunLookupSchema.parse(input);
    const result = await this.options.repository.tryFindByEvaluationId(query);
    if (!result) throw new EvaluationNotFoundError(input.evaluationId);
    return result;
  }

  tryGetRunByEvaluationId(input: {
    tenantId: string;
    evaluationId: string;
    scheduledAt?: Date;
    scheduledAtSlackMs?: number;
  }): Promise<EvaluationRunData | null> {
    return this.options.repository.tryFindByEvaluationId(
      evaluationRunLookupSchema.parse(input),
    );
  }

  findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    return this.options.repository.findByTraceId(
      evaluationRunsByTraceQuerySchema.parse(input),
    );
  }

  findSummariesByTraceIds(input: {
    tenantId: string;
    traceIds: string[];
    since: number;
  }): Promise<Record<string, EvaluationSummary[]>> {
    return this.options.repository.findSummariesByTraceIds(
      evaluationSummariesByTraceIdsQuerySchema.parse(input),
    );
  }

  findTraceEvaluations(input: {
    tenantId: string;
    traceIds: string[];
  }): Promise<Record<string, TraceEvaluationData[]>> {
    return this.options.repository.findTraceEvaluations(
      traceEvaluationsQuerySchema.parse(input),
    );
  }

  async tryGetInputs(input: {
    tenantId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    const query = evaluationInputsQuerySchema.parse(input);
    const inputs = await this.options.repository.tryFindInputs(query);
    return this.options.inputResolution.resolve({
      tenantId: query.tenantId,
      inputs,
    });
  }

  async getMonitorPerformance(
    input: MonitorPerformanceQuery,
  ): Promise<OnlineEvaluationPerformance[]> {
    const query = monitorPerformanceQuerySchema.parse(input);
    const buckets = await this.options.monitorPerformance.findBuckets({
      tenantId: query.tenantId,
      evaluatorIds: query.monitors.map((monitor) => monitor.id),
      previousStartMs: query.previousStartMs,
      currentStartMs: query.currentStartMs,
      endMs: query.endMs,
      timeZone: query.timeZone,
    });
    return summarizeMonitorPerformance(query.monitors, buckets).map((value) =>
      onlineEvaluationPerformanceSchema.parse(value),
    );
  }
}

function summarizeMonitorPerformance(
  monitors: MonitorPerformanceQuery["monitors"],
  buckets: MonitorPerformanceBucket[],
): OnlineEvaluationPerformance[] {
  const bucketsByEvaluator = new Map<string, MonitorPerformanceBucket[]>();
  for (const bucket of buckets) {
    const evaluatorBuckets = bucketsByEvaluator.get(bucket.evaluatorId) ?? [];
    evaluatorBuckets.push(bucket);
    bucketsByEvaluator.set(bucket.evaluatorId, evaluatorBuckets);
  }

  return monitors.map((monitor) => {
    const monitorBuckets = bucketsByEvaluator.get(monitor.id) ?? [];
    const current = monitorBuckets
      .filter((bucket) => bucket.period === "current")
      .map((bucket) => metricTotal(bucket, monitor.isGuardrail));
    const previous = monitorBuckets
      .filter((bucket) => bucket.period === "previous")
      .map((bucket) => metricTotal(bucket, monitor.isGuardrail));

    return {
      monitorId: monitor.id,
      metric: monitor.isGuardrail ? "pass_rate" : "score",
      points: current
        .filter((total) => total.count > 0)
        .map((total) => total.sum / total.count),
      current: average(current),
      previous: average(previous),
    };
  });
}

function metricTotal(
  bucket: MonitorPerformanceBucket,
  isGuardrail: boolean,
): { sum: number; count: number } {
  return isGuardrail
    ? { sum: bucket.passSum, count: bucket.passCount }
    : { sum: bucket.scoreSum, count: bucket.scoreCount };
}

function average(totals: Array<{ sum: number; count: number }>): number | null {
  const sum = totals.reduce((value, total) => value + total.sum, 0);
  const count = totals.reduce((value, total) => value + total.count, 0);
  return count > 0 ? sum / count : null;
}

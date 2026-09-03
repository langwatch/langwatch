import {
  EvaluationNotFoundError,
  EvaluationService as EvaluationServiceContract,
  evaluationInputsQuerySchema,
  evaluationRunDataSchema,
  evaluationRunLookupSchema,
  evaluationRunsByTraceQuerySchema,
  evaluationExecutionResultSchema,
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
import type { WorkflowService } from "@langwatch/workflow-contract";
import type {
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
} from "../ports/evaluation.port";
import type { MonitorPerformanceRepository } from "../repositories/monitor-performance.repository";
import { MonitorPerformanceService } from "./monitor-performance.service";
import type { EvaluationRunRepository } from "../repositories/evaluation.repository";

export type EvaluationServiceOptions = {
  repository: EvaluationRunRepository;
  monitorPerformance: MonitorPerformanceRepository;
  execution: EvaluationExecutionPort;
  inputResolution: EvaluationInputsResolutionPort;
  workflows: WorkflowService;
};

/** One canonical Evaluation capability for API, workers and projections. */
export class EvaluationService extends EvaluationServiceContract {
  static create(options: EvaluationServiceOptions): EvaluationService {
    return new EvaluationService(options);
  }

  private readonly monitorPerformance: MonitorPerformanceService;

  private constructor(private readonly options: EvaluationServiceOptions) {
    super();
    // The trend is composable on its own, and one process composes it that
    // way: the monitors page reads it without an executor. Delegated rather
    // than duplicated so both callers fold the same buckets the same way.
    this.monitorPerformance = MonitorPerformanceService.create({
      repository: options.monitorPerformance,
    });
  }

  async executeForTrace(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult> {
    const command = executeEvaluationCommandSchema.parse(input);
    if (command.workflowId) {
      await this.options.workflows.assertInProject({
        workflowId: command.workflowId,
        projectId: command.projectId,
      });
    }

    return evaluationExecutionResultSchema.parse(await this.options.execution.execute(command));
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
    if (!result) {
      throw new EvaluationNotFoundError(input.evaluationId);
    }

    return result;
  }

  tryGetRunByEvaluationId(input: {
    tenantId: string;
    evaluationId: string;
    scheduledAt?: Date;
    scheduledAtSlackMs?: number;
  }): Promise<EvaluationRunData | null> {
    return this.options.repository.tryFindByEvaluationId(evaluationRunLookupSchema.parse(input));
  }

  findRunsByTraceId(input: { tenantId: string; traceId: string }): Promise<EvaluationRunData[]> {
    return this.options.repository.findByTraceId(evaluationRunsByTraceQuerySchema.parse(input));
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
    return this.options.repository.findTraceEvaluations(traceEvaluationsQuerySchema.parse(input));
  }

  async tryGetInputs(input: {
    tenantId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    const query = evaluationInputsQuerySchema.parse(input);
    const inputs = await this.options.repository.tryFindInputs(query);

    return this.options.inputResolution.tryResolve({
      tenantId: query.tenantId,
      inputs,
    });
  }

  getMonitorPerformance(input: MonitorPerformanceQuery): Promise<OnlineEvaluationPerformance[]> {
    return this.monitorPerformance.getMonitorPerformance(input);
  }
}

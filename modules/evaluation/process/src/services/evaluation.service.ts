import { type Authorization, internalActor, narrowAuthorization } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EvaluationNotFoundError,
  evaluationInputsQuerySchema,
  evaluationRunDataSchema,
  evaluationRunLookupSchema,
  evaluationRunsByTraceQuerySchema,
  evaluationExecutionResultSchema,
  executeEvaluationCommandSchema,
  upsertEvaluationRunCommandSchema,
  type EvaluationExecutionResult,
  type EvaluationRunData,
  type EvaluationRunLookup,
  type MonitorPerformanceQuery,
  type OnlineEvaluationPerformance,
  type ExecuteEvaluationCommand,
  type UpsertEvaluationRunCommand,
  type EvaluationInputsQuery,
} from "@langwatch/evaluation-contract";
import { canReadCapturedContent, type TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { EvaluationExecutionService } from "../features/execution/services/evaluation-execution.service.ts";
import type { EvaluationInputsOffloadService } from "../features/execution/services/evaluation-inputs-offload.service.ts";
import { MonitorPerformanceService } from "../features/monitors/services/monitor-performance.service.ts";
import type {
  EvaluationRunRepository,
  EvaluationRetentionLookup,
} from "../repositories/evaluation.repository.ts";
import type { MonitorPerformanceRepository } from "../repositories/monitor-performance.repository.ts";

type EvaluationServiceOptions = {
  repository: EvaluationRunRepository;
  monitorPerformance: MonitorPerformanceRepository;
  retention: EvaluationRetentionLookup;
  execution: Pick<EvaluationExecutionService, "execute">;
  inputResolution: Pick<EvaluationInputsOffloadService, "resolveInputs">;
  workflows: WorkflowApi;
  traces: Pick<TraceApi, "resolveViewerProtections">;
  /** Mints the own-only proof the `*Api` run reads are fenced by (ruling AGG-EVAL-PROOF). */
  authz: Pick<AuthzApi, "authorizeInternal">;
};

/** The internal actor the `*Api` run reads mint their proof as. */
const RUN_READ_CODE_PATH = "evaluation.run-read";

/** One canonical Evaluation capability for API, workers and projections. */
export class EvaluationService {
  static create(options: EvaluationServiceOptions): EvaluationService {
    return new EvaluationService(options);
  }

  private readonly monitorPerformance: MonitorPerformanceService;

  private constructor(private readonly options: EvaluationServiceOptions) {
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

  async getRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData> {
    const { tenantId, ...lookup } = evaluationRunLookupSchema.parse(input);
    return this.options.repository.getByEvaluationId({
      ...lookup,
      authorization: await this.ownProof({
        projectId: tenantId,
        entry: "EvaluationService.getRunByEvaluationId",
      }),
      retention: this.options.retention,
    });
  }

  async findRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null> {
    try {
      return await this.getRunByEvaluationId(input);
    } catch (error) {
      if (error instanceof EvaluationNotFoundError) return null;
      throw error;
    }
  }

  async findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    const { tenantId, traceId } = evaluationRunsByTraceQuerySchema.parse(input);
    return this.options.repository.findByTraceId({
      authorization: await this.ownProof({
        projectId: tenantId,
        entry: "EvaluationService.findRunsByTraceId",
      }),
      traceId,
    });
  }

  /** The `*Api` names a tenant, not a proof: the platform reads that one project as itself. */
  private ownProof({
    projectId,
    entry,
  }: {
    projectId: string;
    entry: string;
  }): Promise<Authorization> {
    return this.options.authz.authorizeInternal({
      actor: internalActor(RUN_READ_CODE_PATH),
      projectId,
      permission: "traces:view",
      purpose: { kind: "operator", entry },
    });
  }

  /**
   * One evaluation's inputs through the proof (ADR-177 block F): on an aggregate it narrows to the
   * member holding them. Gated on the viewer's protections before any offload marker resolves,
   * and the marker resolves under the member the row was read from.
   */
  async findInputs(
    input: EvaluationInputsQuery & { authorization: Authorization; userId: string | null },
  ): Promise<Record<string, unknown> | null> {
    const query = evaluationInputsQuerySchema.parse(input);
    const authorization =
      query.tenantId === undefined
        ? input.authorization
        : narrowAuthorization({ authorization: input.authorization, projectId: query.tenantId });
    if (authorization === null) throw new EvaluationNotFoundError(query.evaluationId);

    const protections = await this.options.traces.resolveViewerProtections({
      projectId: query.projectId,
      userId: input.userId,
      authorization,
    });
    if (!canReadCapturedContent(protections)) return null;

    const read = await this.options.repository.findInputs({
      authorization,
      evaluationId: query.evaluationId,
    });
    if (read === null || read.inputs === null) return null;

    return this.options.inputResolution.resolveInputs({
      tenantId: read.tenantId,
      inputs: read.inputs,
    });
  }

  getMonitorPerformance(input: MonitorPerformanceQuery): Promise<OnlineEvaluationPerformance[]> {
    return this.monitorPerformance.getMonitorPerformance(input);
  }
}

import { mappingsReadEvaluationsSource } from "@langwatch/dataset-contract";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorService,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { isNativeEvaluatorType } from "@langwatch/evaluator-contract";
import { codeEvaluatorIdFromCheckType } from "@langwatch/evaluator-contract";
import {
  type EvaluationExecutionResult,
  EvaluatorConfigError,
  EvaluatorNotFoundError,
  TraceNotEvaluatableError,
} from "@langwatch/evaluation-contract";
import type { MappingState } from "@langwatch/dataset-contract";
import type { Trace } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import {
  type EvaluationExecutionTelemetryPort,
  type EvaluationLangevalsPort,
  type EvaluationModelEnvPort,
  type EvaluationSpanDigestPort,
  type EvaluationTraceProtections,
  type EvaluationTraceReadPort,
  type EvaluationWorkflowExecutorPort,
} from "../ports/evaluation-execution.port.ts";
import { type EvaluatorInstallEnvironment } from "./evaluator-availability.service.ts";
import { EvaluationThreadMappingService } from "./evaluation-thread-mapping.service.ts";
import { EvaluationDataService } from "./evaluation-data.service.ts";
import { executionResultOf } from "../rules/evaluation-execution-result.rules.ts";
import {
  maxCausalityDepthOfSpans,
  tryExtractParentTraceForNlpgo,
} from "../rules/evaluation-causality.rules.ts";

// Evaluations need full access to trace data — no user-facing redaction.
const INTERNAL_PROTECTIONS: EvaluationTraceProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

// ---------------------------------------------------------------------------
// Dependency interfaces (colocated — not shared)
// ---------------------------------------------------------------------------

export interface EvaluationExecutionDeps {
  traceService: EvaluationTraceReadPort;
  spanDigest: EvaluationSpanDigestPort;
  modelEnvResolver: EvaluationModelEnvPort;
  langevalsClient: EvaluationLangevalsPort;
  workflows: WorkflowApi;
  evaluators: EvaluatorService;
  workflowExecutor: EvaluationWorkflowExecutorPort;
  /**
   * The install environment the optional evaluators read their opt-out
   * switches from. Stated by the process rather than read here, because a
   * package does not read `process.env`.
   */
  installEnvironment: EvaluatorInstallEnvironment;
  /** Absent on a process that composes no metrics registry. */
  telemetry?: EvaluationExecutionTelemetryPort;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * What the evaluator dispatch is handed, in the engine's own terms.
 */
export type DataForEvaluation =
  | { type: "default"; data: Record<string, unknown> }
  | { type: "custom"; data: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EvaluationExecutionService {
  static create(deps: EvaluationExecutionDeps): EvaluationExecutionService {
    return new EvaluationExecutionService(deps);
  }

  private readonly evaluationData: EvaluationDataService;

  private constructor(private readonly deps: EvaluationExecutionDeps) {
    this.evaluationData = EvaluationDataService.create(deps);
  }

  async executeForTrace(params: {
    projectId: string;
    traceId: string;
    evaluatorType: string;
    settings: Record<string, unknown> | string | number | boolean | null;
    mappings: MappingState | null;
    level?: "trace" | "thread";
    workflowId?: string | null;
    idempotencyKey?: string;
  }): Promise<EvaluationExecutionResult> {
    const {
      projectId,
      traceId,
      evaluatorType,
      settings,
      mappings,
      level,
      workflowId,
      idempotencyKey,
    } = params;

    const trace = await this.loadTraceForEvaluation({ projectId, traceId, mappings });

    if (trace.error && !trace.input && !trace.output) {
      return {
        status: "skipped",
        details: "Cannot evaluate trace with errors",
      };
    }

    // 3. Determine evaluation level
    const isThreadLevel = level
      ? level === "thread"
      : EvaluationThreadMappingService.hasThreadMappings(mappings);

    const evaluationThreadId =
      isThreadLevel && trace.metadata?.thread_id ? trace.metadata.thread_id : undefined;

    // A thread-based evaluation needs a thread_id to group the conversation. A trace without
    // one can never be thread-evaluated, so skip it here — before building thread data (which
    // would throw) and before calling the evaluator. Callers drop every skipped result silently
    // so a thread monitor running over non-thread traces stays cheap instead of erroring on
    // every trace.
    if (isThreadLevel && !trace.metadata?.thread_id) {
      return {
        status: "skipped",
        details: "Trace has no thread_id for thread-based evaluation",
      };
    }

    // 4. Build evaluation data
    const data = await this.evaluationData.buildDataForEvaluation({
      evaluatorType,
      trace,
      mappings,
      isThreadLevel,
      projectId,
    });

    // 5. Execute evaluation
    const normalizedSettings = settings && typeof settings === "object" ? settings : undefined;

    // Compute parent causality depth from the trace's spans; nlpgo
    // increments and stamps the result on every span it emits.
    const parentCausalityDepth = maxCausalityDepthOfSpans(
      trace.spans as unknown as Array<{
        attributes?: Record<string, unknown> | null;
      }>,
    );

    const result = await this.runEvaluation({
      projectId,
      evaluatorType,
      data,
      settings: normalizedSettings,
      trace,
      workflowId,
      parentCausalityDepth,
      idempotencyKey,
    });

    return executionResultOf({
      result,
      evaluationThreadId,
      inputs: data.data as Record<string, unknown>,
    });
  }

  /**
   * The trace the evaluator sees. Evaluators must see the FULL IO values (not the 64 KB
   * preview), so this opts into blob resolution (#4888), and it attaches the trace's
   * evaluations where a field mapping reads them — `getTracesWithSpans` leaves them empty.
   */
  private async loadTraceForEvaluation({
    projectId,
    traceId,
    mappings,
  }: {
    projectId: string;
    traceId: string;
    mappings: MappingState | null;
  }): Promise<Trace> {
    const traces = await this.deps.traceService.getTracesWithSpans(
      projectId,
      [traceId],
      INTERNAL_PROTECTIONS,
      undefined,
      { full: true },
    );
    const trace = traces[0];
    if (!trace) {
      throw new TraceNotEvaluatableError(traceId);
    }

    if (mappingsReadEvaluationsSource(mappings)) {
      const evaluationsByTrace = await this.deps.traceService.getEvaluationsMultiple(
        projectId,
        [traceId],
        INTERNAL_PROTECTIONS,
      );
      trace.evaluations = (evaluationsByTrace[traceId] ?? []) as Trace["evaluations"];
    }

    return trace;
  }

  /**
   * One evaluator over data the caller already holds, with no trace behind it.
   */
  executeForData(params: {
    projectId: string;
    evaluatorType: string;
    data: DataForEvaluation;
    settings?: Record<string, unknown>;
    workflowId?: string | null;
    idempotencyKey?: string;
  }): Promise<SingleEvaluationResult> {
    return this.runEvaluation(params);
  }

  // ---------------------------------------------------------------------------
  // Data building (reuses existing mapping functions)
  // ---------------------------------------------------------------------------

  /**
   * Server-only mapping sources need data this service alone can produce
   * (e.g. a formatted transcript from the span digest) — fills those fields
   * into `mappedData` in place.
   */
  // ---------------------------------------------------------------------------
  // Evaluation execution (built-in vs custom/workflow)
  // ---------------------------------------------------------------------------

  private async runEvaluation(params: {
    projectId: string;
    evaluatorType: string;
    data: DataForEvaluation;
    settings?: Record<string, unknown>;
    trace?: Trace;
    workflowId?: string | null;
    parentCausalityDepth?: number;
    idempotencyKey?: string;
  }): Promise<SingleEvaluationResult> {
    const {
      projectId,
      evaluatorType,
      data,
      settings,
      trace,
      workflowId,
      parentCausalityDepth,
      idempotencyKey,
    } = params;

    if (data.type === "custom") {
      return this.runCustomOrCodeEvaluation({
        projectId,
        evaluatorType,
        data: data.data,
        trace,
        workflowId,
        parentCausalityDepth,
      });
    }

    const builtInType = evaluatorType as EvaluatorTypes;
    const evaluator = AVAILABLE_EVALUATORS[builtInType];
    if (!evaluator) {
      throw new EvaluatorNotFoundError(evaluatorType);
    }

    const droppedCategories = trace?.privacy?.droppedCategories ?? [];

    // Native (in-process) evaluators skip the analysis service; both they and
    // the remote ones run through the shared augmenter so redaction or drop at
    // ingestion never hides a leak from the result.
    if (isNativeEvaluatorType(builtInType)) {
      return this.runNativeEvaluation({
        builtInType,
        data: data.data,
        settings,
        droppedCategories,
      });
    }

    const evaluatorEnv = await this.deps.modelEnvResolver.resolveForEvaluator({
      evaluatorType: builtInType,
      evaluator,
      projectId,
      settings,
    });

    const result = await this.deps.langevalsClient.evaluate({
      evaluatorType: builtInType,
      data: data.data,
      settings: settings ?? {},
      env: evaluatorEnv,
      idempotencyKey,
    });

    return this.deps.evaluators.augmentResult({
      evaluatorType: builtInType,
      mappedData: data.data,
      settings,
      droppedCategories,
      result,
    });
  }

  /** A code evaluator answers in-process; anything else custom is a workflow run. */
  private async runCustomOrCodeEvaluation({
    projectId,
    evaluatorType,
    data,
    trace,
    workflowId,
    parentCausalityDepth,
  }: {
    projectId: string;
    evaluatorType: string;
    data: Record<string, unknown>;
    trace?: Trace;
    workflowId?: string | null;
    parentCausalityDepth?: number;
  }): Promise<SingleEvaluationResult> {
    const codeEvaluatorId = codeEvaluatorIdFromCheckType(evaluatorType);
    if (codeEvaluatorId) {
      return this.deps.evaluators.executeCode({
        projectId,
        evaluatorId: codeEvaluatorId,
        data,
        traceId: trace?.trace_id,
        parentCausalityDepth,
        parentTrace: tryExtractParentTraceForNlpgo(trace),
      });
    }

    return this.runCustomEvaluation(
      projectId,
      evaluatorType,
      data,
      trace,
      workflowId,
      parentCausalityDepth,
    );
  }

  /**
   * Native evaluators skip the analysis service; both they and the remote ones run through the
   * shared augmenter, so redaction or drop at ingestion never hides a leak from the result.
   */
  private async runNativeEvaluation({
    builtInType,
    data,
    settings,
    droppedCategories,
  }: {
    builtInType: EvaluatorTypes;
    data: Record<string, unknown>;
    settings: Record<string, unknown> | undefined;
    droppedCategories: string[];
  }): Promise<SingleEvaluationResult> {
    const nativeStart = performance.now();
    const nativeResult = await this.deps.evaluators.executeNative({
      evaluatorType: builtInType,
      data,
    });
    this.deps.telemetry?.record({
      evaluatorType: builtInType,
      status: nativeResult.status,
      durationMs: performance.now() - nativeStart,
    });

    return this.deps.evaluators.augmentResult({
      evaluatorType: builtInType,
      mappedData: data,
      settings,
      droppedCategories,
      result: nativeResult,
    });
  }

  private async runCustomEvaluation(
    projectId: string,
    evaluatorType: string,
    data: Record<string, unknown>,
    trace?: Trace,
    workflowId?: string | null,
    parentCausalityDepth?: number,
  ): Promise<SingleEvaluationResult> {
    const resolvedWorkflowId = workflowId ?? evaluatorType.split("/")[1];

    if (!resolvedWorkflowId) {
      throw new EvaluatorConfigError("Workflow ID is required");
    }

    const requestBody: Record<string, unknown> = {
      trace_id: trace?.trace_id,
      do_not_trace: true,
      ...data,
    };

    // W3C trace context: link the eval workflow's spans to the parent
    // trace's root span so Studio's waterfall renders them as a child
    // sub-tree (not a separate orphan trace, which is the 2026-05-14
    // bug rchaves caught in prod).
    const parentTrace = tryExtractParentTraceForNlpgo(trace);

    const response = await this.deps.workflowExecutor.runEvaluationWorkflow(
      resolvedWorkflowId,
      projectId,
      requestBody as Record<string, string>,
      undefined,
      parentCausalityDepth,
      parentTrace,
    );

    if (response.status !== "success") {
      return { ...response.result, status: "error" } as SingleEvaluationResult;
    }

    return { ...response.result, status: "processed" };
  }
}

import type { Protections } from "~/server/elasticsearch/protections";
import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
} from "~/server/evaluations/evaluationMappings";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "~/server/evaluations/evaluators";
import { isNativeEvaluatorType } from "~/server/evaluations/evaluators.native";
import {
  augmentEvaluationResult,
  executeNativeEvaluation,
} from "~/server/evaluations/native/registry";
import {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
} from "~/server/evaluations/threadMappingResolver";
import {
  codeEvaluatorIdFromCheckType,
  isCodeEvaluatorCheckType,
} from "~/server/evaluators/codeEvaluator";
import { runCodeEvaluator } from "~/server/evaluators/runCodeEvaluator";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import {
  type MappingState,
  mapTraceToDatasetEntry,
  SERVER_ONLY_THREAD_SOURCES,
  SERVER_ONLY_TRACE_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import type { TraceService } from "~/server/traces/trace.service";
import type { LangEvalsClient } from "../clients/langevals/langevals.client";
import {
  EvaluatorConfigError,
  EvaluatorNotFoundError,
  TraceNotEvaluatableError,
} from "./errors";
import type { EvaluationExecutionResult } from "./evaluation-execution.types";

// Evaluations need full access to trace data — no user-facing redaction.
const INTERNAL_PROTECTIONS: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

// ---------------------------------------------------------------------------
// Dependency interfaces (colocated — not shared)
// ---------------------------------------------------------------------------

export interface EvaluationExecutionDeps {
  traceService: TraceService;
  modelEnvResolver: ModelEnvResolver;
  langevalsClient: LangEvalsClient;
  workflowExecutor: WorkflowExecutor;
}

export interface ModelEnvResolver {
  resolveForEvaluator(params: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>>;
}

export interface WorkflowExecutor {
  runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, string>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: string }>;
}

const TRACE_ID_HEX = /^[0-9a-fA-F]{32}$/;
const SPAN_ID_HEX = /^[0-9a-fA-F]{16}$/;

/**
 * Extract the W3C `traceparent` context for the eval workflow from the
 * parent trace. nlpgo needs both pieces (32-hex trace_id + 16-hex root
 * span_id) so its emitted spans land as children of the parent trace
 * in Studio's waterfall rather than as a separate orphan trace.
 *
 * Returns `undefined` when the parent trace doesn't have OTel-standard
 * IDs (legacy `trace_<nanoid>` shape, missing root span) — in that
 * case nlpgo falls back to body-supplied req.TraceID and emits without
 * a parent linkage. Callers should NOT default-emit a synthesized
 * parent: a synth parent_span_id would render under a non-existent
 * span in the waterfall, which is worse UX than a separate trace.
 */
export function extractParentTraceForNlpgo(
  trace: Trace | undefined,
): { traceId: string; parentSpanId: string } | undefined {
  if (!trace?.trace_id || !TRACE_ID_HEX.test(trace.trace_id)) return undefined;

  // Broken / multi-source instrumentation can leave a trace with more
  // than one parent-less span. `find()` would then pick whichever span
  // happened to be ingested first — non-deterministic across re-runs.
  // Sort by started_at (earliest is the true root in any sane trace)
  // with span_id as the tie-breaker to keep two consecutive eval runs
  // pinned to the same parent_span_id.
  const rootCandidates = (trace.spans ?? []).filter((s) => !s.parent_id);
  if (rootCandidates.length === 0) return undefined;
  rootCandidates.sort((a, b) => {
    const aStart = a.timestamps?.started_at ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.timestamps?.started_at ?? Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) return aStart - bStart;
    return (a.span_id ?? "").localeCompare(b.span_id ?? "");
  });
  const rootSpan = rootCandidates[0];
  if (!rootSpan?.span_id || !SPAN_ID_HEX.test(rootSpan.span_id))
    return undefined;
  return {
    traceId: trace.trace_id.toLowerCase(),
    parentSpanId: rootSpan.span_id.toLowerCase(),
  };
}

/**
 * Returns the max `langwatch.causality_depth` across the supplied spans
 * (0 if absent on all). The dispatcher uses this to pass the parent
 * depth to nlpgo, which increments and stamps on every span it emits.
 * Loop-prevention design lives in
 * specs/monitors/online-evaluator-loop-prevention.feature.
 *
 * Real-world spans come from `mapNormalizedSpanToSpan` which unflattens
 * OTLP dot-notation attributes into nested objects under `span.params`,
 * so `langwatch.causality_depth` lives at `params.langwatch.causality_depth`.
 * We also probe a few legacy / synthetic shapes used by tests and older
 * span sources so the helper is robust to both.
 */
export function maxCausalityDepthOfSpans(
  spans:
    | Array<{
        params?: Record<string, unknown> | null;
        attributes?: Record<string, unknown> | null;
      }>
    | undefined
    | null,
): number {
  if (!spans || spans.length === 0) return 0;
  let max = 0;
  for (const span of spans) {
    const raw = pickCausalityDepth(span);
    if (raw === undefined || raw === null) continue;
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number.parseInt(raw, 10)
          : NaN;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function pickCausalityDepth(span: {
  params?: Record<string, unknown> | null;
  attributes?: Record<string, unknown> | null;
}): unknown {
  // Real production path: unflattened in params.langwatch.causality_depth.
  const params = (span.params ?? null) as Record<string, unknown> | null;
  if (params) {
    const ns = params.langwatch as Record<string, unknown> | undefined;
    if (ns && ns.causality_depth !== undefined) return ns.causality_depth;
    if (params["langwatch.causality_depth"] !== undefined) {
      return params["langwatch.causality_depth"];
    }
  }
  // Legacy / synthetic test path.
  const attrs = (span.attributes ?? null) as Record<string, unknown> | null;
  if (attrs && attrs["langwatch.causality_depth"] !== undefined) {
    return attrs["langwatch.causality_depth"];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type DataForEvaluation =
  | { type: "default"; data: Record<string, unknown> }
  | { type: "custom"; data: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EvaluationExecutionService {
  constructor(private readonly deps: EvaluationExecutionDeps) {}

  async executeForTrace(params: {
    projectId: string;
    traceId: string;
    evaluatorType: string;
    settings: Record<string, unknown> | string | number | boolean | null;
    mappings: MappingState | null;
    level?: "trace" | "thread";
    workflowId?: string | null;
  }): Promise<EvaluationExecutionResult> {
    const {
      projectId,
      traceId,
      evaluatorType,
      settings,
      mappings,
      level,
      workflowId,
    } = params;

    // 1. Fetch trace
    const traces = await this.deps.traceService.getTracesWithSpans(
      projectId,
      [traceId],
      INTERNAL_PROTECTIONS,
    );
    const trace = traces[0];

    if (!trace) {
      throw new TraceNotEvaluatableError(traceId);
    }

    // 2. Validate trace is evaluatable
    if (trace.error && !trace.input && !trace.output) {
      return {
        status: "skipped",
        details: "Cannot evaluate trace with errors",
      };
    }

    // 3. Determine evaluation level
    const isThreadLevel = level
      ? level === "thread"
      : hasThreadMappings(mappings);

    const evaluationThreadId =
      isThreadLevel && trace.metadata?.thread_id
        ? trace.metadata.thread_id
        : undefined;

    // A thread-based evaluation needs a thread_id to group the conversation.
    // A trace without one can never be thread-evaluated, so skip it here —
    // before building thread data (which would throw) and before calling the
    // evaluator. Callers drop every skipped result silently so a thread monitor
    // running over non-thread traces stays cheap instead of erroring on every
    // trace.
    if (isThreadLevel && !trace.metadata?.thread_id) {
      return {
        status: "skipped",
        details: "Trace has no thread_id for thread-based evaluation",
      };
    }

    // 4. Build evaluation data
    const data = await this.buildDataForEvaluation({
      evaluatorType,
      trace,
      mappings,
      isThreadLevel,
      projectId,
    });

    // 5. Execute evaluation
    const normalizedSettings =
      settings && typeof settings === "object" ? settings : undefined;

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
    });

    const isError = result.status === "error";
    const rawDetails = "details" in result ? result.details : undefined;
    const traceback =
      isError && "traceback" in result && Array.isArray(result.traceback)
        ? result.traceback.join("\n")
        : undefined;

    return {
      status: result.status,
      score: result.status === "processed" ? result.score : undefined,
      passed: result.status === "processed" ? result.passed : undefined,
      label: result.status === "processed" ? result.label : undefined,
      details: isError ? undefined : rawDetails,
      error: isError ? (rawDetails ?? "Evaluator failed") : undefined,
      errorDetails: traceback,
      cost:
        result.status === "processed" && "cost" in result && result.cost
          ? result.cost
          : undefined,
      evaluationThreadId,
      inputs: data.data as Record<string, unknown>,
    };
  }

  // ---------------------------------------------------------------------------
  // Data building (reuses existing mapping functions)
  // ---------------------------------------------------------------------------

  private async buildDataForEvaluation(params: {
    evaluatorType: string;
    trace: Trace;
    mappings: MappingState | null;
    isThreadLevel: boolean;
    projectId: string;
  }): Promise<DataForEvaluation> {
    const { evaluatorType, trace, mappings, isThreadLevel, projectId } = params;

    let data: Record<string, unknown>;

    if (isThreadLevel) {
      data = await this.buildThreadData(projectId, trace, mappings);
    } else {
      const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
      if (!mappedData) {
        throw new TraceNotEvaluatableError(trace.trace_id);
      }

      // Fill in server-only trace sources
      if (mappings?.mapping) {
        for (const [field, config] of Object.entries(mappings.mapping)) {
          if (
            "source" in config &&
            (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
              config.source,
            )
          ) {
            if (config.source === "formatted_trace") {
              (mappedData as Record<string, unknown>)[field] =
                await formatSpansDigest(trace.spans ?? []);
            }
          }
        }
      }

      data = mappedData as Record<string, unknown>;

      // Resolve any thread-typed mappings mixed into trace-level evaluations
      if (mappings && hasThreadMappings(mappings)) {
        await resolveThreadMappingsIntoData({
          data,
          trace,
          mappings,
          getThreadTraces: (threadId) =>
            this.deps.traceService.getTracesWithSpansByThreadIds(
              projectId,
              [threadId],
              INTERNAL_PROTECTIONS,
            ),
        });
      }
    }

    // Workflow/code/custom evaluators pass data through as-is
    if (
      evaluatorType.startsWith("custom/") ||
      evaluatorType === "workflow" ||
      isCodeEvaluatorCheckType(evaluatorType)
    ) {
      return { type: "custom", data };
    }

    const evaluator = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
    if (!evaluator) {
      throw new EvaluatorNotFoundError(evaluatorType);
    }

    const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
    const filtered = Object.fromEntries(
      fields.map((field) => [field, data[field] ?? ""]),
    );

    return { type: "default", data: filtered };
  }

  private async buildThreadData(
    projectId: string,
    trace: Trace,
    mappings: MappingState | null,
  ): Promise<Record<string, unknown>> {
    if (!mappings) {
      throw new EvaluatorConfigError(
        "Mapping state is required for thread-based evaluation",
      );
    }

    const threadId = trace.metadata?.thread_id;
    if (!threadId) {
      throw new EvaluatorConfigError(
        "Trace does not have a thread_id for thread-based evaluation",
      );
    }

    const threadTraces =
      await this.deps.traceService.getTracesWithSpansByThreadIds(
        projectId,
        [threadId],
        INTERNAL_PROTECTIONS,
      );

    const result: Record<string, unknown> = {};

    for (const [targetField, mappingConfig] of Object.entries(
      mappings.mapping,
    )) {
      const isThreadMapping =
        ("type" in mappingConfig && mappingConfig.type === "thread") ||
        ("source" in mappingConfig &&
          (mappingConfig.source in THREAD_MAPPINGS ||
            (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(
              mappingConfig.source,
            )));

      if (isThreadMapping && "source" in mappingConfig) {
        const source = mappingConfig.source;
        if (!source) continue;

        if (
          (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)
        ) {
          if (source === "formatted_traces") {
            result[targetField] = (
              await Promise.all(
                threadTraces.map((t) => formatSpansDigest(t.spans ?? [])),
              )
            ).join("\n\n---\n\n");
          }
        } else {
          const threadSource = source as keyof typeof THREAD_MAPPINGS;
          const selectedFields =
            ("selectedFields" in mappingConfig
              ? mappingConfig.selectedFields
              : undefined) ?? [];
          result[targetField] = THREAD_MAPPINGS[threadSource].mapping(
            { thread_id: threadId, traces: threadTraces },
            selectedFields as (keyof typeof TRACE_MAPPINGS)[],
          );
        }
      } else if ("source" in mappingConfig) {
        // Regular trace mapping
        if (
          (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
            mappingConfig.source,
          )
        ) {
          if (mappingConfig.source === "formatted_trace") {
            result[targetField] = await formatSpansDigest(trace.spans ?? []);
          }
        } else {
          const traceMappingConfig: {
            source: string;
            key?: string;
            subkey?: string;
          } = {
            source: mappingConfig.source,
            key: mappingConfig.key,
            subkey: mappingConfig.subkey,
          };
          const mapped = mapTraceToDatasetEntry(
            trace,
            { [targetField]: traceMappingConfig },
            new Set(),
            undefined,
            undefined,
          )[0];
          result[targetField] = mapped?.[targetField];
        }
      }
    }

    return result;
  }

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
  }): Promise<SingleEvaluationResult> {
    const {
      projectId,
      evaluatorType,
      data,
      settings,
      trace,
      workflowId,
      parentCausalityDepth,
    } = params;

    // Custom/workflow/code evaluators
    if (data.type === "custom") {
      const codeEvaluatorId = codeEvaluatorIdFromCheckType(evaluatorType);
      if (codeEvaluatorId) {
        return runCodeEvaluator({
          projectId,
          evaluatorId: codeEvaluatorId,
          data: data.data,
          traceId: trace?.trace_id,
          parentCausalityDepth,
          parentTrace: extractParentTraceForNlpgo(trace),
        });
      }
      return this.runCustomEvaluation(
        projectId,
        evaluatorType,
        data.data,
        trace,
        workflowId,
        parentCausalityDepth,
      );
    }

    // Built-in evaluators
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
      const nativeResult = await executeNativeEvaluation({
        evaluatorType: builtInType,
        data: data.data,
      });
      return augmentEvaluationResult({
        evaluatorType: builtInType,
        mappedData: data.data,
        settings,
        droppedCategories,
        result: nativeResult,
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
    });

    return augmentEvaluationResult({
      evaluatorType: builtInType,
      mappedData: data.data,
      settings,
      droppedCategories,
      result,
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
    const parentTrace = extractParentTraceForNlpgo(trace);

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

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

function switchMapping(
  trace: Trace,
  mapping_: MappingState,
): Record<string, string | number> | undefined {
  const mapping: MappingState =
    "mapping" in mapping_
      ? mapping_
      : migrateLegacyMappings(mapping_ as unknown as Record<string, string>);

  return mapTraceToDatasetEntry(
    trace,
    mapping.mapping as Record<
      string,
      {
        source: string;
        key?: string;
        subkey?: string;
      }
    >,
    new Set(),
    undefined,
    undefined,
  )[0];
}

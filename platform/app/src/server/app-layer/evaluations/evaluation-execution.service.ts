import {
  DEFAULT_MAPPINGS,
  mappingsReadEvaluationsSource,
  migrateLegacyMappings,
} from "~/server/evaluations/evaluationMappings";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "~/server/evaluations/evaluators";
import { isNativeEvaluatorType } from "~/server/evaluations/evaluators.native";
import {
  evaluatorUnavailability,
  unavailableEvaluatorMessage,
} from "~/server/evaluations/installedEvaluators";
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
import type { Protections } from "~/server/traces/protections";
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
  runEvaluationWorkflow(params: {
    workflowId: string;
    projectId: string;
    inputs: Record<string, string>;
    versionId?: string;
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<{ result: SingleEvaluationResult; status: string }>;
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
    const n = toFiniteCausalityDepth(raw);
    if (n !== undefined && n > max) max = n;
  }
  return max;
}

function toFiniteCausalityDepth(raw: unknown): number | undefined {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : NaN;
  return Number.isFinite(n) ? n : undefined;
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

    const trace = await this.fetchTraceForEvaluation({ projectId, traceId });

    if (trace.error && !trace.input && !trace.output) {
      return {
        status: "skipped",
        details: "Cannot evaluate trace with errors",
      };
    }

    const levelResult = this.determineEvaluationLevel({
      level,
      mappings,
      trace,
    });
    if (levelResult.skipped) {
      return { status: "skipped", details: levelResult.details };
    }
    const { isThreadLevel, evaluationThreadId } = levelResult;

    await this.attachEvaluationsIfNeeded({
      trace,
      projectId,
      traceId,
      mappings,
    });

    const data = await this.buildDataForEvaluation({
      evaluatorType,
      trace,
      mappings,
      isThreadLevel,
      projectId,
    });

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

    return buildExecutionResult({ result, data, evaluationThreadId });
  }

  // Evaluators must see the FULL IO values (not the 64 KB preview), so opt
  // into blob resolution (#4888). Under the per-call gate (replacing
  // construction-time gating) this is what keeps the eval path resolving
  // offloaded event refs.
  private async fetchTraceForEvaluation(params: {
    projectId: string;
    traceId: string;
  }): Promise<Trace> {
    const { projectId, traceId } = params;
    const traces = await this.deps.traceService.getTracesWithSpans({
      projectId,
      traceIds: [traceId],
      protections: INTERNAL_PROTECTIONS,
      opts: { full: true },
    });
    const trace = traces[0];

    if (!trace) {
      throw new TraceNotEvaluatableError(traceId);
    }
    return trace;
  }

  private determineEvaluationLevel(params: {
    level?: "trace" | "thread";
    mappings: MappingState | null;
    trace: Trace;
  }):
    | { skipped: true; details: string }
    | { skipped: false; isThreadLevel: boolean; evaluationThreadId?: string } {
    const { level, mappings, trace } = params;

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
        skipped: true,
        details: "Trace has no thread_id for thread-based evaluation",
      };
    }

    return { skipped: false, isThreadLevel, evaluationThreadId };
  }

  // getTracesWithSpans does not populate `trace.evaluations`, but evaluator
  // field mappings that read the `evaluations` source need them. Fetch and
  // attach before building the mapped data so they aren't silently empty
  // (parity with runEvaluationForTrace in runEvaluation.ts). Gated on the
  // mappings actually reading the `evaluations` source — this runs on the
  // hot live-monitor path and the fetch is a heavy Inputs-projection
  // ClickHouse read that most evaluator mappings never need.
  private async attachEvaluationsIfNeeded(params: {
    trace: Trace;
    projectId: string;
    traceId: string;
    mappings: MappingState | null;
  }): Promise<void> {
    const { trace, projectId, traceId, mappings } = params;
    if (!mappingsReadEvaluationsSource(mappings)) return;

    const evaluationsByTrace =
      await this.deps.traceService.getEvaluationsMultiple(
        projectId,
        [traceId],
        INTERNAL_PROTECTIONS,
      );
    trace.evaluations = evaluationsByTrace[traceId] ?? [];
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

    const data = isThreadLevel
      ? await this.buildThreadData(projectId, trace, mappings)
      : await this.buildTraceLevelData({ trace, mappings, projectId });

    return shapeDataForEvaluatorType({ evaluatorType, data });
  }

  private async buildTraceLevelData(params: {
    trace: Trace;
    mappings: MappingState | null;
    projectId: string;
  }): Promise<Record<string, unknown>> {
    const { trace, mappings, projectId } = params;

    const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
    if (!mappedData) {
      throw new TraceNotEvaluatableError(trace.trace_id);
    }

    await fillServerOnlyTraceSources({
      mappedData: mappedData as Record<string, unknown>,
      mappings,
      trace,
    });

    const data = mappedData as Record<string, unknown>;

    // Resolve any thread-typed mappings mixed into trace-level evaluations
    if (mappings && hasThreadMappings(mappings)) {
      await resolveThreadMappingsIntoData({
        data,
        trace,
        mappings,
        getThreadTraces: (threadId) =>
          this.deps.traceService.getTracesWithSpansByThreadIds({
            projectId,
            threadIds: [threadId],
            protections: INTERNAL_PROTECTIONS,
            opts: { full: true },
          }),
      });
    }

    return data;
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
      await this.deps.traceService.getTracesWithSpansByThreadIds({
        projectId,
        threadIds: [threadId],
        protections: INTERNAL_PROTECTIONS,
        opts: { full: true },
      });

    const result: Record<string, unknown> = {};

    for (const [targetField, mappingConfig] of Object.entries(
      mappings.mapping,
    )) {
      const value = await resolveThreadOrTraceFieldValue({
        mappingConfig,
        targetField,
        threadId,
        threadTraces,
        trace,
      });

      if (value !== FIELD_NOT_MAPPED) {
        result[targetField] = value;
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
      return this.runCustomEvaluation({
        projectId,
        evaluatorType,
        data: data.data,
        trace,
        workflowId,
        parentCausalityDepth,
      });
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

  private async runCustomEvaluation({
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

    const response = await this.deps.workflowExecutor.runEvaluationWorkflow({
      workflowId: resolvedWorkflowId,
      projectId,
      inputs: requestBody as Record<string, string>,
      causalityDepth: parentCausalityDepth,
      parentTrace,
    });

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

  return mapTraceToDatasetEntry({
    trace,
    mapping: mapping.mapping as Record<
      string,
      {
        source: string;
        key?: string;
        subkey?: string;
      }
    >,
    expansions: new Set(),
  })[0];
}

// Fill in server-only trace sources
async function fillServerOnlyTraceSources(params: {
  mappedData: Record<string, unknown>;
  mappings: MappingState | null;
  trace: Trace;
}): Promise<void> {
  const { mappedData, mappings, trace } = params;
  if (!mappings?.mapping) return;

  for (const [field, config] of Object.entries(mappings.mapping)) {
    if (
      "source" in config &&
      (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(config.source)
    ) {
      if (config.source === "formatted_trace") {
        mappedData[field] = await formatSpansDigest(trace.spans ?? []);
      }
    }
  }
}

function extractProcessedResultFields(result: SingleEvaluationResult): {
  score?: number;
  passed?: boolean;
  label?: string;
  cost?: EvaluationExecutionResult["cost"];
} {
  if (result.status !== "processed") return {};
  return {
    score: result.score,
    passed: result.passed,
    label: result.label,
    cost: result.cost ? result.cost : undefined,
  };
}

function extractErrorTraceback(
  result: SingleEvaluationResult,
): string | undefined {
  if (result.status !== "error") return undefined;
  return Array.isArray(result.traceback)
    ? result.traceback.join("\n")
    : undefined;
}

function buildExecutionResult({
  result,
  data,
  evaluationThreadId,
}: {
  result: SingleEvaluationResult;
  data: DataForEvaluation;
  evaluationThreadId?: string;
}): EvaluationExecutionResult {
  const isError = result.status === "error";
  const rawDetails = "details" in result ? result.details : undefined;

  return {
    status: result.status,
    ...extractProcessedResultFields(result),
    details: isError ? undefined : rawDetails,
    error: isError ? (rawDetails ?? "Evaluator failed") : undefined,
    errorDetails: extractErrorTraceback(result),
    evaluationThreadId,
    inputs: data.data as Record<string, unknown>,
  };
}

// Workflow/code/custom evaluators pass data through as-is; built-in
// evaluators must be resolvable and available on this install, and their
// data narrowed to the evaluator's required/optional fields.
function shapeDataForEvaluatorType(params: {
  evaluatorType: string;
  data: Record<string, unknown>;
}): DataForEvaluation {
  const { evaluatorType, data } = params;

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

  // An evaluator this install skipped is not a broken one. Say which it is,
  // and how to get it, rather than letting the request reach an evaluator
  // service with no route for it and come back as a bare 404.
  const unavailable = evaluatorUnavailability({ evaluatorType });
  if (unavailable) {
    throw new EvaluatorConfigError(
      unavailableEvaluatorMessage({ unavailability: unavailable }),
      {
        meta: { evaluatorType },
      },
    );
  }

  const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
  const filtered = Object.fromEntries(
    fields.map((field) => [field, data[field] ?? ""]),
  );

  return { type: "default", data: filtered };
}

// Sentinel distinguishing "no value produced for this field" from an
// explicit `undefined` assignment (which mapTraceToDatasetEntry can return).
const FIELD_NOT_MAPPED = Symbol("field-not-mapped");

function isThreadSourceMapping(
  mappingConfig: MappingState["mapping"][string],
): boolean {
  return (
    ("type" in mappingConfig && mappingConfig.type === "thread") ||
    ("source" in mappingConfig &&
      (mappingConfig.source in THREAD_MAPPINGS ||
        (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(
          mappingConfig.source,
        )))
  );
}

// Dispatches a single mapping-config field to the thread-mapping resolver or
// the trace-mapping resolver, matching the original priority: a config
// lacking `source` is never mapped; among the rest, thread-shaped sources
// win over regular trace sources.
async function resolveThreadOrTraceFieldValue(params: {
  mappingConfig: MappingState["mapping"][string];
  targetField: string;
  threadId: string;
  threadTraces: Trace[];
  trace: Trace;
}): Promise<unknown> {
  const { mappingConfig, targetField, threadId, threadTraces, trace } = params;
  if (!("source" in mappingConfig)) return FIELD_NOT_MAPPED;

  return isThreadSourceMapping(mappingConfig)
    ? resolveThreadFieldValue({ mappingConfig, threadId, threadTraces })
    : resolveTraceFieldValue({ mappingConfig, targetField, trace });
}

async function resolveThreadFieldValue(params: {
  mappingConfig: MappingState["mapping"][string];
  threadId: string;
  threadTraces: Trace[];
}): Promise<unknown> {
  const { mappingConfig, threadId, threadTraces } = params;
  if (!("source" in mappingConfig)) return FIELD_NOT_MAPPED;

  const source = mappingConfig.source;
  if (!source) return FIELD_NOT_MAPPED;

  if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
    if (source === "formatted_traces") {
      return (
        await Promise.all(
          threadTraces.map((t) => formatSpansDigest(t.spans ?? [])),
        )
      ).join("\n\n---\n\n");
    }
    return FIELD_NOT_MAPPED;
  }

  const threadSource = source as keyof typeof THREAD_MAPPINGS;
  const selectedFields =
    ("selectedFields" in mappingConfig
      ? mappingConfig.selectedFields
      : undefined) ?? [];
  return THREAD_MAPPINGS[threadSource].mapping(
    { thread_id: threadId, traces: threadTraces },
    selectedFields as (keyof typeof TRACE_MAPPINGS)[],
  );
}

// Regular trace mapping
async function resolveTraceFieldValue(params: {
  mappingConfig: MappingState["mapping"][string];
  targetField: string;
  trace: Trace;
}): Promise<unknown> {
  const { mappingConfig, targetField, trace } = params;
  if (!("source" in mappingConfig)) return FIELD_NOT_MAPPED;

  if (
    (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
      mappingConfig.source,
    )
  ) {
    if (mappingConfig.source === "formatted_trace") {
      return await formatSpansDigest(trace.spans ?? []);
    }
    return FIELD_NOT_MAPPED;
  }

  const traceMappingConfig: {
    source: string;
    key?: string;
    subkey?: string;
  } = {
    source: mappingConfig.source,
    key: mappingConfig.key,
    subkey: mappingConfig.subkey,
  };
  const mapped = mapTraceToDatasetEntry({
    trace,
    mapping: { [targetField]: traceMappingConfig },
    expansions: new Set(),
  })[0];
  return mapped?.[targetField];
}

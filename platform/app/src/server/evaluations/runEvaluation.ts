import { EvaluatorConfigError } from "~/server/app-layer/evaluations/errors";
import { setupModelEnv } from "~/server/app-layer/evaluations/evaluation-execution.factories";
import { codeEvaluatorIdFromCheckType } from "~/server/evaluators/codeEvaluator";
import { runCodeEvaluator } from "~/server/evaluators/runCodeEvaluator";
import { stagedLangevalsFetch } from "~/server/langevals/stagedFetch";
import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { TraceService } from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import { env } from "../../env.mjs";
import {
  AVAILABLE_EVALUATORS,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../server/evaluations/evaluators";
import { isNativeEvaluatorType } from "../../server/evaluations/evaluators.native";
import {
  augmentEvaluationResult,
  executeNativeEvaluation,
} from "../../server/evaluations/native/registry";
import {
  AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
  isAzureEvaluatorType,
} from "../app-layer/evaluations/azure-safety-env";
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env.server";
import {
  extractParentTraceForNlpgo,
  maxCausalityDepthOfSpans,
} from "../app-layer/evaluations/evaluation-execution.service";
import {
  evaluationDurationHistogram,
  getEvaluationStatusCounter,
} from "../metrics";
import { formatSpansDigest } from "../tracer/spanToReadableSpan";
import {
  type MappingState,
  mapTraceToDatasetEntry,
  SERVER_ONLY_THREAD_SOURCES,
  SERVER_ONLY_TRACE_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
  tryAndConvertTo,
} from "../tracer/tracesMapping";
import { runEvaluationWorkflow } from "../workflows/runWorkflow";
import {
  DEFAULT_MAPPINGS,
  mappingsReadEvaluationsSource,
  migrateLegacyMappings,
} from "./evaluationMappings";
import {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
} from "./threadMappingResolver";

export type DataForEvaluation =
  | {
      type: "default";
      data: Record<string, string | number | undefined | null>;
    }
  | {
      type: "custom";
      data: Record<string, any>;
    };

export type EvaluationResultWithThreadId = SingleEvaluationResult & {
  evaluation_thread_id?: string;
  inputs?: Record<string, any>;
};

type MappingConfigEntry = MappingState["mapping"][string];

function isThreadMappingConfig(mappingConfig: MappingConfigEntry): boolean {
  return (
    ("type" in mappingConfig && mappingConfig.type === "thread") ||
    ("source" in mappingConfig &&
      (mappingConfig.source in THREAD_MAPPINGS ||
        (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(
          mappingConfig.source,
        )))
  );
}

async function assignThreadField({
  result,
  targetField,
  mappingConfig,
  threadId,
  threadTraces,
}: {
  result: Record<string, any>;
  targetField: string;
  mappingConfig: MappingConfigEntry;
  threadId: string;
  threadTraces: Trace[];
}): Promise<void> {
  if (!("source" in mappingConfig)) return;
  const source = mappingConfig.source;
  if (!source) return;

  if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
    if (source === "formatted_traces") {
      result[targetField] = (
        await Promise.all(
          threadTraces.map((t) => formatSpansDigest(t.spans ?? [])),
        )
      ).join("\n\n---\n\n");
    }
    return;
  }

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

async function assignTraceField({
  result,
  targetField,
  mappingConfig,
  trace,
}: {
  result: Record<string, any>;
  targetField: string;
  mappingConfig: MappingConfigEntry;
  trace: Trace;
}): Promise<void> {
  if (!("source" in mappingConfig)) return;

  if (
    (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
      mappingConfig.source,
    )
  ) {
    if (mappingConfig.source === "formatted_trace") {
      result[targetField] = await formatSpansDigest(trace.spans ?? []);
    }
    return;
  }

  const traceMappingConfig = {
    source: mappingConfig.source,
    key: mappingConfig.key,
    subkey: mappingConfig.subkey,
  };
  const mapped = mapTraceToDatasetEntry({
    trace,
    mapping: { [targetField]: traceMappingConfig as any },
    expansions: new Set(),
  })[0];
  result[targetField] = mapped?.[targetField];
}

const buildThreadData = async ({
  projectId,
  trace,
  mappingState,
  protections,
}: {
  projectId: string;
  trace: Trace;
  mappingState: MappingState | null;
  protections: Protections;
}): Promise<Record<string, any>> => {
  if (!mappingState) {
    throw new Error("Mapping state is required for thread-based evaluation");
  }
  const threadId = trace.metadata?.thread_id;
  if (!threadId) {
    throw new EvaluatorConfigError(
      "Trace does not have a thread_id for thread-based evaluation",
    );
  }

  // #4991: evaluators score against content, so the thread read must resolve
  // the FULL offloaded IO (ADR-022), not the ≤64KB preview.
  const traceService = TraceService.create(
    undefined,
    buildTraceBlobResolutionDeps(),
  );
  const threadTraces = await traceService.getTracesByThreadId({
    projectId,
    threadId,
    protections,
    opts: { full: true },
  });

  const result: Record<string, any> = {};

  for (const [targetField, mappingConfig] of Object.entries(
    mappingState.mapping,
  )) {
    if (isThreadMappingConfig(mappingConfig)) {
      await assignThreadField({
        result,
        targetField,
        mappingConfig,
        threadId,
        threadTraces,
      });
    } else {
      await assignTraceField({ result, targetField, mappingConfig, trace });
    }
  }

  return result;
};

const switchMapping = (
  trace: Trace,
  mapping_: MappingState,
): Record<string, string | number> | undefined => {
  const mapping = !mapping_
    ? DEFAULT_MAPPINGS
    : "mapping" in mapping_
      ? mapping_
      : migrateLegacyMappings(mapping_ as any);

  return mapTraceToDatasetEntry({
    trace,
    mapping: mapping.mapping as Record<
      string,
      {
        source: keyof typeof TRACE_MAPPINGS | "";
        key?: string;
        subkey?: string;
      }
    >,
    expansions: new Set(),
  })[0];
};

async function applyServerOnlyTraceOverrides({
  mappedData,
  mappings,
  trace,
}: {
  mappedData: Record<string, any>;
  mappings: MappingState | null;
  trace: Trace;
}): Promise<void> {
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

async function buildTraceLevelData({
  trace,
  mappings,
  projectId,
  protections,
}: {
  trace: Trace;
  mappings: MappingState | null;
  projectId: string;
  protections: Protections;
}): Promise<Record<string, any>> {
  const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
  if (!mappedData) {
    throw new Error("No mapped data found to run evaluator");
  }

  await applyServerOnlyTraceOverrides({ mappedData, mappings, trace });

  if (mappings && hasThreadMappings(mappings)) {
    const traceService = TraceService.create(
      undefined,
      buildTraceBlobResolutionDeps(),
    );
    await resolveThreadMappingsIntoData({
      data: mappedData as Record<string, unknown>,
      trace,
      mappings,
      getThreadTraces: (threadId) =>
        traceService.getTracesByThreadId({
          projectId,
          threadId,
          protections,
          opts: { full: true },
        }),
    });
  }

  return mappedData;
}

function projectEvaluatorFields({
  evaluatorType,
  data,
}: {
  evaluatorType: EvaluatorTypes | "workflow";
  data: Record<string, any>;
}): Record<string, any> {
  const evaluator = AVAILABLE_EVALUATORS[evaluatorType];
  const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
  return Object.fromEntries(fields.map((field) => [field, data[field] ?? ""]));
}

const buildDataForEvaluation = async ({
  evaluatorType,
  trace,
  mappings,
  isThreadLevel,
  projectId,
  protections,
}: {
  evaluatorType: EvaluatorTypes | "workflow";
  trace: Trace;
  mappings: MappingState | null;
  isThreadLevel: boolean;
  projectId: string;
  protections: Protections;
}): Promise<DataForEvaluation> => {
  const data = isThreadLevel
    ? await buildThreadData({
        projectId,
        trace,
        mappingState: mappings,
        protections,
      })
    : await buildTraceLevelData({ trace, mappings, projectId, protections });

  if (evaluatorType.startsWith("custom/") || evaluatorType === "workflow") {
    return { type: "custom", data };
  }

  return {
    type: "default",
    data: projectEvaluatorFields({ evaluatorType, data }),
  };
};

export const runEvaluationForTrace = async ({
  projectId,
  traceId,
  evaluatorType,
  settings,
  mappings,
  level,
  protections,
  workflowId,
}: {
  projectId: string;
  traceId: string;
  evaluatorType: EvaluatorTypes | "workflow";
  settings: Record<string, any> | string | number | boolean | null;
  mappings: MappingState | null;
  level?: "trace" | "thread";
  protections: Protections;
  workflowId?: string | null;
}): Promise<EvaluationResultWithThreadId> => {
  // #4991: the trace being evaluated is read content-first — resolve the
  // FULL offloaded IO (ADR-022) so the evaluator never scores a preview.
  const traceService = TraceService.create(
    undefined,
    buildTraceBlobResolutionDeps(),
  );
  const trace = await traceService.getById({
    projectId,
    traceId,
    protections,
    opts: { full: true },
  });
  if (!trace) {
    throw new Error("trace not found");
  }

  if (trace.error && !trace.input && !trace.output) {
    return {
      status: "skipped",
      details: "Cannot evaluate trace with errors",
    };
  }

  const isThreadLevel = level
    ? level === "thread"
    : hasThreadMappings(mappings);
  const evaluation_thread_id =
    isThreadLevel && trace.metadata?.thread_id
      ? trace.metadata.thread_id
      : undefined;

  // Parity with the legacy worker's getTraceById({ includeEvaluations: true }):
  // getById → getTracesWithSpans does not enrich evaluations, but evaluator
  // field mappings that read the `evaluations` source need them. Fetch and
  // attach before building the mapped data so they aren't silently empty.
  // Gated on the mappings actually reading the `evaluations` source — the
  // fetch is a heavy Inputs-projection ClickHouse read that most evaluator
  // mappings never need.
  if (mappingsReadEvaluationsSource(mappings)) {
    const evaluationsByTrace = await traceService.getEvaluationsMultiple(
      projectId,
      [traceId],
      protections,
    );
    trace.evaluations = evaluationsByTrace[traceId] ?? [];
  }

  const data = await buildDataForEvaluation({
    evaluatorType,
    trace,
    mappings,
    isThreadLevel,
    projectId,
    protections,
  });

  const result = await runEvaluation({
    projectId,
    evaluatorType,
    data,
    settings: settings && typeof settings === "object" ? settings : undefined,
    trace,
    workflowId,
    parentCausalityDepth: maxCausalityDepthOfSpans(
      trace.spans as unknown as Array<{
        attributes?: Record<string, unknown> | null;
      }>,
    ),
  });

  return {
    ...result,
    evaluation_thread_id,
    inputs: data.data,
  };
};

async function runCustomEvaluationPath({
  projectId,
  evaluatorType,
  data,
  trace,
  workflowId,
  parentCausalityDepth,
}: {
  projectId: string;
  evaluatorType: EvaluatorTypes | "workflow";
  data: Record<string, any>;
  trace?: Trace;
  workflowId?: string | null;
  parentCausalityDepth?: number;
}): Promise<SingleEvaluationResult> {
  // Code evaluators arrive as `{type:"custom"}` with an evaluatorType of
  // `code/<id>`; route them to the code-evaluator runner instead of letting
  // `customEvaluation` treat the id as an nlpgo workflow id. Mirrors
  // EvaluationExecutionService.runEvaluation.
  const codeEvaluatorId = codeEvaluatorIdFromCheckType(evaluatorType);
  if (codeEvaluatorId) {
    return runCodeEvaluator({
      projectId,
      evaluatorId: codeEvaluatorId,
      data,
      traceId: trace?.trace_id,
      parentCausalityDepth,
      parentTrace: extractParentTraceForNlpgo(trace),
    });
  }
  return customEvaluation({
    projectId,
    evaluatorType,
    data,
    trace,
    workflowId,
    parentCausalityDepth,
  });
}

// Native (in-process) evaluators short-circuit the langevals HTTP call. They
// still run through the shared augmenter so a leak that ingestion redaction
// already scrubbed, or content that was dropped, is reflected in the result.
async function runNativeEvaluationPath({
  builtInEvaluatorType,
  data,
  settings,
  droppedCategories,
}: {
  builtInEvaluatorType: EvaluatorTypes;
  data: Record<string, any>;
  settings?: Record<string, unknown>;
  droppedCategories: string[];
}): Promise<SingleEvaluationResult> {
  const nativeResult = await executeNativeEvaluation({
    evaluatorType: builtInEvaluatorType,
    data,
  });
  return augmentEvaluationResult({
    evaluatorType: builtInEvaluatorType,
    mappedData: data,
    settings,
    droppedCategories,
    result: nativeResult,
  });
}

type EvaluatorEnvResolution =
  | { ok: true; env: Record<string, string> }
  | { ok: false; result: SingleEvaluationResult };

async function resolveAzureOrDefaultEnv({
  builtInEvaluatorType,
  projectId,
  evaluator,
}: {
  builtInEvaluatorType: EvaluatorTypes;
  projectId: string;
  evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
}): Promise<EvaluatorEnvResolution> {
  if (isAzureEvaluatorType(builtInEvaluatorType)) {
    const azureEnv = await getAzureSafetyEnvFromProject(projectId);
    if (!azureEnv) {
      return {
        ok: false,
        result: {
          status: "skipped",
          details: AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
        },
      };
    }
    return { ok: true, env: azureEnv };
  }
  return {
    ok: true,
    env: Object.fromEntries(
      (evaluator.envVars ?? []).map((envVar) => [envVar, process.env[envVar]!]),
    ),
  };
}

// `openai/moderation` carries a `model` setting ("text-moderation-*") that is
// not a configured provider model, so it must skip model-env resolution.
async function applyModelEnvOverride({
  evaluatorEnv,
  builtInEvaluatorType,
  projectId,
  settings,
}: {
  evaluatorEnv: Record<string, string>;
  builtInEvaluatorType: EvaluatorTypes;
  projectId: string;
  settings?: Record<string, unknown>;
}): Promise<EvaluatorEnvResolution> {
  if (
    !(
      settings &&
      typeof settings === "object" &&
      "model" in settings &&
      typeof settings.model === "string" &&
      builtInEvaluatorType !== "openai/moderation"
    )
  ) {
    return { ok: true, env: evaluatorEnv };
  }

  try {
    const modelEnv = await setupModelEnv({
      model: settings.model,
      embeddings: false,
      projectId,
      settings,
    });
    return { ok: true, env: { ...evaluatorEnv, ...modelEnv } };
  } catch (error) {
    if (error instanceof EvaluatorConfigError) {
      return {
        ok: false,
        result: { status: "skipped", details: error.message },
      };
    }
    throw error;
  }
}

// Evaluators that embed (ragas faithfulness/context-precision, semantic
// similarity) need a separate X_LITELLM_EMBEDDINGS_* block for their
// embeddings provider.
async function applyEmbeddingsEnvOverride({
  evaluatorEnv,
  projectId,
  settings,
}: {
  evaluatorEnv: Record<string, string>;
  projectId: string;
  settings?: Record<string, unknown>;
}): Promise<EvaluatorEnvResolution> {
  if (
    !(
      settings &&
      typeof settings === "object" &&
      "embeddings_model" in settings &&
      typeof settings.embeddings_model === "string"
    )
  ) {
    return { ok: true, env: evaluatorEnv };
  }

  try {
    const embeddingsEnv = await setupModelEnv({
      model: settings.embeddings_model,
      embeddings: true,
      projectId,
      settings,
    });
    return { ok: true, env: { ...evaluatorEnv, ...embeddingsEnv } };
  } catch (error) {
    if (error instanceof EvaluatorConfigError) {
      return {
        ok: false,
        result: { status: "skipped", details: error.message },
      };
    }
    throw error;
  }
}

async function resolveEvaluatorEnv({
  builtInEvaluatorType,
  projectId,
  evaluator,
  settings,
}: {
  builtInEvaluatorType: EvaluatorTypes;
  projectId: string;
  evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
  settings?: Record<string, unknown>;
}): Promise<EvaluatorEnvResolution> {
  const azureOrDefaultEnv = await resolveAzureOrDefaultEnv({
    builtInEvaluatorType,
    projectId,
    evaluator,
  });
  if (!azureOrDefaultEnv.ok) return azureOrDefaultEnv;

  const withModelEnv = await applyModelEnvOverride({
    evaluatorEnv: azureOrDefaultEnv.env,
    builtInEvaluatorType,
    projectId,
    settings,
  });
  if (!withModelEnv.ok) return withModelEnv;

  return applyEmbeddingsEnvOverride({
    evaluatorEnv: withModelEnv.env,
    projectId,
    settings,
  });
}

// Preserve evaluator-specific fields (e.g. pairwise's candidate_a_id,
// candidate_a_output) that the legacy canonical-6 forward would otherwise
// strip. Bounded to the evaluator's declared required + optional fields so a
// stray mapping output on a non-pairwise evaluator can't ride through and 422
// a strict pydantic model on the langevals side — the spread is opt-in per
// evaluator, not a catch-all. The canonical 6 are normalized below; anything
// else declared in the evaluator's contract passes through as-is. Mirrors the
// block that lived in the deleted background/workers/evaluationsWorker.ts
// (added upstream in #5142 for langevals/pairwise_compare).
const CANONICAL_EVALUATION_KEYS = new Set([
  "input",
  "output",
  "contexts",
  "expected_contexts",
  "expected_output",
  "conversation",
]);

function selectAllowedExtras({
  evaluator,
  data,
}: {
  evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
  data: Record<string, any>;
}): Record<string, unknown> {
  const allowedExtras = new Set([
    ...(evaluator.requiredFields ?? []),
    ...(evaluator.optionalFields ?? []),
  ]);
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (CANONICAL_EVALUATION_KEYS.has(key)) continue;
    if (!allowedExtras.has(key)) continue;
    extras[key] = value;
  }
  return extras;
}

async function fetchLangevalsResult({
  builtInEvaluatorType,
  projectId,
  extras,
  data,
  settings,
  evaluatorEnv,
}: {
  builtInEvaluatorType: EvaluatorTypes;
  projectId: string;
  extras: Record<string, unknown>;
  data: Record<string, any>;
  settings?: Record<string, unknown>;
  evaluatorEnv: Record<string, string>;
}) {
  try {
    return await stagedLangevalsFetch({
      url: `${env.LANGEVALS_ENDPOINT}/${builtInEvaluatorType}/evaluate`,
      projectId,
      kind: "evaluation",
      body: {
        data: [
          {
            ...extras,
            input: tryAndConvertTo(data.input, "string"),
            output: tryAndConvertTo(data.output, "string"),
            contexts: tryAndConvertTo(data.contexts, "string[]"),
            expected_contexts: tryAndConvertTo(
              data.expected_contexts,
              "string[]",
            ),
            expected_output: tryAndConvertTo(data.expected_output, "string"),
            conversation: tryAndConvertTo(data.conversation, "array"),
          },
        ],
        settings: settings && typeof settings === "object" ? settings : {},
        env: evaluatorEnv,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("fetch failed")) {
      throw new Error("Evaluator cannot be reached");
    }
    throw error;
  }
}

async function readLangevalsErrorDetails(
  response: Awaited<ReturnType<typeof stagedLangevalsFetch>>,
): Promise<string> {
  let statusText = response.statusText;
  try {
    statusText = JSON.stringify(await response.json(), undefined, 2);
  } catch {
    /* safe json parse fallback */
  }
  return statusText;
}

function normalizeLangevalsRawResult<T extends BatchEvaluationResult[number]>(
  raw: T,
): T {
  return {
    ...raw,
    ...("score" in raw && {
      score: typeof raw.score === "number" ? raw.score : undefined,
    }),
    ...("passed" in raw && {
      passed: typeof raw.passed === "boolean" ? raw.passed : undefined,
    }),
  };
}

async function handleLangevalsFetchResult({
  response,
  builtInEvaluatorType,
  retries,
  retryEvaluation,
  data,
  settings,
  droppedCategories,
}: {
  response: Awaited<ReturnType<typeof fetchLangevalsResult>>;
  builtInEvaluatorType: EvaluatorTypes;
  retries: number;
  retryEvaluation: () => Promise<SingleEvaluationResult>;
  data: DataForEvaluation;
  settings?: Record<string, unknown>;
  droppedCategories: string[];
}): Promise<SingleEvaluationResult> {
  if (!response.ok) {
    if (response.status >= 500 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Forward trace/workflowId/parentCausalityDepth so the retried attempt
      // keeps the redaction context (trace.privacy.droppedCategories) and the
      // causality linkage — omitting them made a guardrail retried after a
      // transient 5xx report clean instead of flagging dropped content.
      return retryEvaluation();
    }
    getEvaluationStatusCounter(builtInEvaluatorType, "error").inc();
    const statusText = await readLangevalsErrorDetails(response);
    throw new Error(`${response.status} ${statusText}`);
  }

  const raw = ((await response.json()) as BatchEvaluationResult)[0];
  if (!raw) {
    getEvaluationStatusCounter(builtInEvaluatorType, "error").inc();
    throw new Error("Unexpected response: empty results");
  }

  const result = normalizeLangevalsRawResult(raw);

  getEvaluationStatusCounter(builtInEvaluatorType, result.status).inc();

  return augmentEvaluationResult({
    evaluatorType: builtInEvaluatorType,
    mappedData: data.data,
    settings,
    droppedCategories,
    result,
  });
}

export const runEvaluation = async ({
  projectId,
  evaluatorType,
  data,
  settings,
  trace,
  workflowId,
  retries = 1,
  parentCausalityDepth,
}: {
  projectId: string;
  evaluatorType: EvaluatorTypes | "workflow";
  data: DataForEvaluation;
  settings?: Record<string, unknown>;
  trace?: Trace;
  workflowId?: string | null;
  retries?: number;
  parentCausalityDepth?: number;
}): Promise<SingleEvaluationResult> => {
  if (data.type === "custom") {
    return runCustomEvaluationPath({
      projectId,
      evaluatorType,
      data: data.data,
      trace,
      workflowId,
      parentCausalityDepth,
    });
  }

  const builtInEvaluatorType = (
    Object.keys(AVAILABLE_EVALUATORS) as EvaluatorTypes[]
  ).find((k) => k === evaluatorType);

  if (!builtInEvaluatorType) {
    throw new Error(`Evaluator ${evaluatorType} not found`);
  }

  const droppedCategories = trace?.privacy?.droppedCategories ?? [];

  if (isNativeEvaluatorType(builtInEvaluatorType)) {
    return runNativeEvaluationPath({
      builtInEvaluatorType,
      data: data.data,
      settings,
      droppedCategories,
    });
  }

  const evaluator = AVAILABLE_EVALUATORS[builtInEvaluatorType];

  const evaluatorEnvResolution = await resolveEvaluatorEnv({
    builtInEvaluatorType,
    projectId,
    evaluator,
    settings,
  });
  if (!evaluatorEnvResolution.ok) return evaluatorEnvResolution.result;
  const evaluatorEnv = evaluatorEnvResolution.env;

  const startTime = performance.now();

  const extras = selectAllowedExtras({ evaluator, data: data.data });

  const response = await fetchLangevalsResult({
    builtInEvaluatorType,
    projectId,
    extras,
    data: data.data,
    settings,
    evaluatorEnv,
  });

  const duration = performance.now() - startTime;
  evaluationDurationHistogram.labels(builtInEvaluatorType).observe(duration);

  return handleLangevalsFetchResult({
    response,
    builtInEvaluatorType,
    retries,
    retryEvaluation: () =>
      runEvaluation({
        projectId,
        evaluatorType: builtInEvaluatorType,
        data,
        settings,
        trace,
        workflowId,
        parentCausalityDepth,
        retries: retries - 1,
      }),
    data,
    settings,
    droppedCategories,
  });
};

const customEvaluation = async ({
  projectId,
  evaluatorType,
  data,
  trace,
  workflowId,
  parentCausalityDepth,
}: {
  projectId: string;
  evaluatorType: EvaluatorTypes | "workflow";
  data: Record<string, any>;
  trace?: Trace;
  workflowId?: string | null;
  parentCausalityDepth?: number;
}): Promise<SingleEvaluationResult> => {
  const resolvedWorkflowId = workflowId ?? evaluatorType.split("/")[1];

  const requestBody: Record<string, any> = {
    trace_id: trace?.trace_id,
    do_not_trace: false,
    ...data,
  };

  if (!resolvedWorkflowId) {
    throw new Error("Workflow ID is required");
  }

  const parentTrace = extractParentTraceForNlpgo(trace);

  const response = await runEvaluationWorkflow({
    workflowId: resolvedWorkflowId,
    projectId,
    inputs: requestBody,
    parentTrace,
    causalityDepth: parentCausalityDepth,
  });

  const { result, status } = response;

  if (status != "success") {
    return {
      ...result,
      status: "error",
    } as any;
  }

  return {
    ...result,
    status: "processed",
  };
};

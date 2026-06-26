import { EvaluatorConfigError } from "~/server/app-layer/evaluations/errors";
import { setupModelEnv } from "~/server/app-layer/evaluations/evaluation-execution.factories";
import { codeEvaluatorIdFromCheckType } from "~/server/evaluators/codeEvaluator";
import { runCodeEvaluator } from "~/server/evaluators/runCodeEvaluator";
import { stagedLangevalsFetch } from "~/server/langevals/stagedFetch";
import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { TraceService } from "~/server/traces/trace.service";
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
import { prisma } from "../db";
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
import { DEFAULT_MAPPINGS, migrateLegacyMappings } from "./evaluationMappings";
import {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
} from "./threadMappingResolver";

class UserConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConfigError";
  }
}

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

const buildThreadData = async (
  projectId: string,
  trace: Trace,
  mappingState: MappingState | null,
  protections: Protections,
): Promise<Record<string, any>> => {
  if (!mappingState) {
    throw new Error("Mapping state is required for thread-based evaluation");
  }
  const threadId = trace.metadata?.thread_id;
  if (!threadId) {
    throw new UserConfigError(
      "Trace does not have a thread_id for thread-based evaluation",
    );
  }

  const traceService = TraceService.create();
  const threadTraces = await traceService.getTracesByThreadId(
    projectId,
    threadId,
    protections,
  );

  const result: Record<string, any> = {};

  for (const [targetField, mappingConfig] of Object.entries(
    mappingState.mapping,
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

      if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
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
      if (
        (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
          mappingConfig.source,
        )
      ) {
        if (mappingConfig.source === "formatted_trace") {
          result[targetField] = await formatSpansDigest(trace.spans ?? []);
        }
      } else {
        const traceMappingConfig = {
          source: mappingConfig.source,
          key: mappingConfig.key,
          subkey: mappingConfig.subkey,
        };
        const mapped = mapTraceToDatasetEntry(
          trace,
          { [targetField]: traceMappingConfig as any },
          new Set(),
          undefined,
          undefined,
        )[0];
        result[targetField] = mapped?.[targetField];
      }
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

  return mapTraceToDatasetEntry(
    trace,
    mapping.mapping as Record<
      string,
      {
        source: keyof typeof TRACE_MAPPINGS | "";
        key?: string;
        subkey?: string;
      }
    >,
    new Set(),
    undefined,
    undefined,
  )[0];
};

const buildDataForEvaluation = async (
  evaluatorType: EvaluatorTypes | "workflow",
  trace: Trace,
  mappings: MappingState | null,
  isThreadLevel: boolean,
  projectId: string,
  protections: Protections,
): Promise<DataForEvaluation> => {
  let data: Record<string, any>;

  if (isThreadLevel) {
    data = await buildThreadData(projectId, trace, mappings, protections);
  } else {
    const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
    if (!mappedData) {
      throw new Error("No mapped data found to run evaluator");
    }

    if (mappings?.mapping) {
      for (const [field, config] of Object.entries(mappings.mapping)) {
        if (
          "source" in config &&
          (SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(
            config.source,
          )
        ) {
          if (config.source === "formatted_trace") {
            mappedData[field] = await formatSpansDigest(trace.spans ?? []);
          }
        }
      }
    }

    data = mappedData;

    if (mappings && hasThreadMappings(mappings)) {
      const traceService = TraceService.create();
      await resolveThreadMappingsIntoData({
        data: data as Record<string, unknown>,
        trace,
        mappings,
        getThreadTraces: (threadId) =>
          traceService.getTracesByThreadId(projectId, threadId, protections),
      });
    }
  }

  if (evaluatorType.startsWith("custom/") || evaluatorType === "workflow") {
    return { type: "custom", data };
  }

  const evaluator = AVAILABLE_EVALUATORS[evaluatorType];
  const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
  const data_ = Object.fromEntries(
    fields.map((field) => [field, data[field] ?? ""]),
  );

  return { type: "default", data: data_ };
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
  const traceService = TraceService.create();
  const trace = await traceService.getById(projectId, traceId, protections);
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
  const evaluationsByTrace = await traceService.getEvaluationsMultiple(
    projectId,
    [traceId],
    protections,
  );
  trace.evaluations = evaluationsByTrace[traceId] ?? [];

  const data = await buildDataForEvaluation(
    evaluatorType,
    trace,
    mappings,
    isThreadLevel,
    projectId,
    protections,
  );

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
    // Code evaluators arrive as `{type:"custom"}` with an evaluatorType of
    // `code/<id>`; route them to the code-evaluator runner instead of letting
    // `customEvaluation` treat the id as an nlpgo workflow id. Mirrors
    // EvaluationExecutionService.runEvaluation.
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
    return customEvaluation(
      projectId,
      evaluatorType,
      data.data,
      trace,
      workflowId,
      parentCausalityDepth,
    );
  }

  const builtInEvaluatorType = (
    Object.keys(AVAILABLE_EVALUATORS) as EvaluatorTypes[]
  ).find((k) => k === evaluatorType);

  if (!builtInEvaluatorType) {
    throw new Error(`Evaluator ${evaluatorType} not found`);
  }

  const droppedCategories = trace?.privacy?.droppedCategories ?? [];

  // Native (in-process) evaluators short-circuit the langevals HTTP call. They
  // still run through the shared augmenter so a leak that ingestion redaction
  // already scrubbed, or content that was dropped, is reflected in the result.
  if (isNativeEvaluatorType(builtInEvaluatorType)) {
    const nativeResult = await executeNativeEvaluation({
      evaluatorType: builtInEvaluatorType,
      data: data.data,
    });
    return augmentEvaluationResult({
      evaluatorType: builtInEvaluatorType,
      mappedData: data.data,
      settings,
      droppedCategories,
      result: nativeResult,
    });
  }

  const evaluator = AVAILABLE_EVALUATORS[builtInEvaluatorType];

  let evaluatorEnv: Record<string, string>;
  if (isAzureEvaluatorType(builtInEvaluatorType)) {
    const azureEnv = await getAzureSafetyEnvFromProject(projectId);
    if (!azureEnv) {
      return {
        status: "skipped",
        details: AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
      };
    }
    evaluatorEnv = azureEnv;
  } else {
    evaluatorEnv = Object.fromEntries(
      (evaluator.envVars ?? []).map((envVar) => [envVar, process.env[envVar]!]),
    );
  }

  // `openai/moderation` carries a `model` setting ("text-moderation-*") that is
  // not a configured provider model, so it must skip model-env resolution.
  if (
    settings &&
    typeof settings === "object" &&
    "model" in settings &&
    typeof settings.model === "string" &&
    builtInEvaluatorType !== "openai/moderation"
  ) {
    try {
      const modelEnv = await setupModelEnv(
        settings.model,
        false,
        projectId,
        settings,
      );
      evaluatorEnv = { ...evaluatorEnv, ...modelEnv };
    } catch (error) {
      if (error instanceof EvaluatorConfigError) {
        return {
          status: "skipped",
          details: error.message,
        };
      }
      throw error;
    }
  }

  // Evaluators that embed (ragas faithfulness/context-precision, semantic
  // similarity) need a separate X_LITELLM_EMBEDDINGS_* block for their
  // embeddings provider.
  if (
    settings &&
    typeof settings === "object" &&
    "embeddings_model" in settings &&
    typeof settings.embeddings_model === "string"
  ) {
    try {
      const embeddingsEnv = await setupModelEnv(
        settings.embeddings_model,
        true,
        projectId,
        settings,
      );
      evaluatorEnv = { ...evaluatorEnv, ...embeddingsEnv };
    } catch (error) {
      if (error instanceof EvaluatorConfigError) {
        return {
          status: "skipped",
          details: error.message,
        };
      }
      throw error;
    }
  }

  const startTime = performance.now();

  let response;
  try {
    response = await stagedLangevalsFetch({
      url: `${env.LANGEVALS_ENDPOINT}/${builtInEvaluatorType}/evaluate`,
      projectId,
      kind: "evaluation",
      body: {
        data: [
          {
            input: tryAndConvertTo(data.data.input, "string"),
            output: tryAndConvertTo(data.data.output, "string"),
            contexts: tryAndConvertTo(data.data.contexts, "string[]"),
            expected_contexts: tryAndConvertTo(
              data.data.expected_contexts,
              "string[]",
            ),
            expected_output: tryAndConvertTo(
              data.data.expected_output,
              "string",
            ),
            conversation: tryAndConvertTo(data.data.conversation, "array"),
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

  const duration = performance.now() - startTime;
  evaluationDurationHistogram.labels(builtInEvaluatorType).observe(duration);

  if (!response.ok) {
    if (response.status >= 500 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return runEvaluation({
        projectId,
        evaluatorType: builtInEvaluatorType,
        data,
        settings,
        retries: retries - 1,
      });
    }
    getEvaluationStatusCounter(builtInEvaluatorType, "error").inc();
    let statusText = response.statusText;
    try {
      statusText = JSON.stringify(await response.json(), undefined, 2);
    } catch {
      /* safe json parse fallback */
    }
    throw `${response.status} ${statusText}`;
  }

  const raw = ((await response.json()) as BatchEvaluationResult)[0];
  if (!raw) {
    getEvaluationStatusCounter(builtInEvaluatorType, "error").inc();
    throw "Unexpected response: empty results";
  }

  const result: typeof raw = {
    ...raw,
    ...("score" in raw && {
      score: typeof raw.score === "number" ? raw.score : undefined,
    }),
    ...("passed" in raw && {
      passed: typeof raw.passed === "boolean" ? raw.passed : undefined,
    }),
  };

  getEvaluationStatusCounter(builtInEvaluatorType, result.status).inc();

  return augmentEvaluationResult({
    evaluatorType: builtInEvaluatorType,
    mappedData: data.data,
    settings,
    droppedCategories,
    result,
  });
};

const customEvaluation = async (
  projectId: string,
  evaluatorType: EvaluatorTypes | "workflow",
  data: Record<string, any>,
  trace?: Trace,
  workflowId?: string | null,
  parentCausalityDepth?: number,
): Promise<SingleEvaluationResult> => {
  const resolvedWorkflowId = workflowId ?? evaluatorType.split("/")[1];

  const project = await prisma.project.findUnique({
    where: { id: projectId, archivedAt: null },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const requestBody: Record<string, any> = {
    trace_id: trace?.trace_id,
    do_not_trace: false,
    ...data,
  };

  if (!resolvedWorkflowId) {
    throw new Error("Workflow ID is required");
  }

  const parentTrace = extractParentTraceForNlpgo(trace);

  const response = await runEvaluationWorkflow(
    resolvedWorkflowId,
    project.id,
    requestBody,
    undefined,
    parentCausalityDepth,
    parentTrace,
  );

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

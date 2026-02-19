import { CostReferenceType, CostType } from "@prisma/client";
import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { nanoid } from "nanoid";
import { withJobContext } from "../../context/asyncContext";
import { getProtectionsForProject } from "~/server/api/utils";
import type { EvaluationJob } from "~/server/background/types";
import type { Protections } from "~/server/elasticsearch/protections";
import {
  getTraceById,
  getTracesGroupedByThreadId,
} from "~/server/elasticsearch/traces";
import type { Trace } from "~/server/tracer/types";
import { env } from "../../../env.mjs";
import {
  AVAILABLE_EVALUATORS,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../../server/evaluations/evaluators.generated";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";

/**
 * Error class for user configuration issues.
 * These errors are logged as WARN rather than ERROR since they represent
 * user misconfiguration, not system failures.
 */
class UserConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConfigError";
  }
}
import { createCostChecker } from "../../license-enforcement/license-enforcement.repository";
import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { prisma } from "../../db";
import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
} from "../../evaluations/evaluationMappings";
import {
  evaluationDurationHistogram,
  recordJobWaitDuration,
  getEvaluationStatusCounter,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import {
  type MappingState,
  mapTraceToDatasetEntry,
  SERVER_ONLY_THREAD_SOURCES,
  SERVER_ONLY_TRACE_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
  tryAndConvertTo,
} from "../../tracer/tracesMapping";
import { formatSpansDigest } from "../../tracer/spanToReadableSpan";
import { runEvaluationWorkflow } from "../../workflows/runWorkflow";
import {
  EVALUATIONS_QUEUE,
  updateEvaluationStatusInES,
} from "../queues/evaluationsQueue";

const logger = createLogger("langwatch:workers:evaluationsWorker");

export async function runEvaluationJob(
  job: Job<EvaluationJob, any, string>,
): Promise<EvaluationResultWithThreadId> {
  const check = await prisma.monitor.findUnique({
    where: {
      id: job.data.check.evaluator_id,
      projectId: job.data.trace.project_id,
    },
    include: { evaluator: true },
  });
  if (!check) {
    throw `check config ${job.data.check.evaluator_id} not found`;
  }

  const protections = await getProtectionsForProject(prisma, {
    projectId: job.data.trace.project_id,
  });

  // Use evaluator settings if available, otherwise fall back to monitor parameters
  // This supports both new monitors (with evaluatorId) and legacy monitors (with inline parameters)
  const settings = check.evaluator?.config
    ? ((check.evaluator.config as Record<string, any>).settings ??
      check.parameters)
    : check.parameters;

  // For workflow evaluators, get the workflowId from the evaluator
  const workflowId =
    check.evaluator?.type === "workflow"
      ? check.evaluator.workflowId
      : undefined;

  return await runEvaluationForTrace({
    projectId: job.data.trace.project_id,
    traceId: job.data.trace.trace_id,
    evaluatorType: job.data.check.type,
    settings,
    mappings: check.mappings as MappingState | null,
    level: check.level as "trace" | "thread",
    protections,
    workflowId,
  });
}

/**
 * Check if any mapping has type "thread"
 * Single Responsibility: Detect if thread-based mappings are present
 */
const hasThreadMappings = (mappingState: MappingState | null): boolean => {
  if (!mappingState) {
    return false;
  }
  return Object.values(mappingState.mapping).some(
    (mapping) => "type" in mapping && mapping.type === "thread",
  );
};

/**
 * Build thread-based data for evaluation
 * Single Responsibility: Extract and format thread data according to thread mappings
 */
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

  logger.info(
    {
      threadId,
      observedTraceId: trace.trace_id,
      projectId,
    },
    "Fetching thread traces",
  );

  // Fetch all traces in the thread
  const threadTraces = await getTracesGroupedByThreadId({
    connConfig: { projectId },
    threadId,
    protections,
    includeSpans: true,
  });

  logger.info(
    {
      threadId,
      traceCount: threadTraces.length,
      traceIds: threadTraces.map((t) => t.trace_id),
    },
    "Thread traces fetched",
  );

  const result: Record<string, any> = {};

  // Process each mapping
  for (const [targetField, mappingConfig] of Object.entries(
    mappingState.mapping,
  )) {
    const isThreadMapping =
      ("type" in mappingConfig && mappingConfig.type === "thread") ||
      // Backward compat: source in THREAD_MAPPINGS without explicit type
      ("source" in mappingConfig &&
        (mappingConfig.source in THREAD_MAPPINGS ||
          (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(
            mappingConfig.source,
          )));

    if (isThreadMapping && "source" in mappingConfig) {
      const source = mappingConfig.source;

      // Skip empty source
      if (!source) {
        continue;
      }

      // Handle server-only thread sources (e.g. formatted_traces)
      if (
        (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)
      ) {
        if (source === "formatted_traces") {
          result[targetField] = (await Promise.all(threadTraces.map((t) => formatSpansDigest(t.spans ?? []))))
            .join("\n\n---\n\n");
        }
      } else {
        // Use the mapping function from THREAD_MAPPINGS dynamically
        const threadSource = source as keyof typeof THREAD_MAPPINGS;
        const selectedFields =
          ("selectedFields" in mappingConfig
            ? mappingConfig.selectedFields
            : undefined) ?? [];
        result[targetField] = THREAD_MAPPINGS[threadSource].mapping(
          { thread_id: threadId, traces: threadTraces },
          selectedFields as (keyof typeof TRACE_MAPPINGS)[],
        );

        logger.info(
          {
            targetField,
            source,
            ...(selectedFields.length > 0 && { selectedFields }),
            ...(source === "traces" && {
              traceCount: (result[targetField] as any[]).length,
            }),
          },
          "Mapped thread field",
        );
      }
    } else {
      // Regular trace mapping - use current trace
      // Type guard ensures mappingConfig.source is from TRACE_MAPPINGS
      if ("source" in mappingConfig) {
        // Handle server-only trace sources (e.g. formatted_trace)
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
        logger.info(
          {
            targetField,
            source: mappingConfig.source,
            value:
              typeof result[targetField] === "string"
                ? result[targetField].substring(0, 100) + "..."
                : result[targetField],
          },
          "Mapped trace field",
        );
      }
    }
  }

  logger.info(
    {
      threadId,
      resultKeys: Object.keys(result),
    },
    "Thread data build complete",
  );

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

  // No need to filter - switchMapping is only called when hasThreadMappings is false
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

const buildDataForEvaluation = async (
  evaluatorType: EvaluatorTypes | "workflow",
  trace: Trace,
  mappings: MappingState | null,
  isThreadLevel: boolean,
  projectId: string,
  protections: Protections,
): Promise<DataForEvaluation> => {
  let data: Record<string, any>;

  logger.info(
    {
      evaluatorType,
      observedTraceId: trace.trace_id,
      threadId: trace.metadata?.thread_id,
      isThreadLevel,
      mappingKeys: mappings?.mapping ? Object.keys(mappings.mapping) : [],
    },
    "Building data for evaluation",
  );

  if (isThreadLevel) {
    // Use thread-based data extraction
    logger.info(
      {
        observedTraceId: trace.trace_id,
        threadId: trace.metadata?.thread_id,
      },
      "Using thread-based data extraction",
    );
    data = await buildThreadData(projectId, trace, mappings, protections);
  } else {
    // Use regular trace-based mapping
    logger.info(
      {
        observedTraceId: trace.trace_id,
      },
      "Using regular trace-based mapping",
    );
    const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
    if (!mappedData) {
      throw new Error("No mapped data found to run evaluator");
    }

    // Fill in server-only trace sources that mapTraceToDatasetEntry doesn't handle
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
  }

  // Workflow evaluators and custom evaluators pass data through as-is
  // (they handle their own field mappings)
  if (evaluatorType.startsWith("custom/") || evaluatorType === "workflow") {
    return {
      type: "custom",
      data,
    };
  } else {
    const evaluator = AVAILABLE_EVALUATORS[evaluatorType];
    const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
    const data_ = Object.fromEntries(
      fields.map((field) => [field, data[field] ?? ""]),
    );

    return {
      type: "default",
      data: data_,
    };
  }
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
  level?: "trace" | "thread"; // New: explicit level from monitor, falls back to mapping detection for backward compat
  protections: Protections;
  workflowId?: string | null; // For workflow evaluators, the actual workflow ID
}): Promise<EvaluationResultWithThreadId> => {
  const trace = await getTraceById({
    connConfig: { projectId },
    traceId,
    protections,
    includeEvaluations: true,
    includeSpans: true,
  });
  if (!trace) {
    throw "trace not found";
  }

  if (trace.error && !trace.input && !trace.output) {
    return {
      status: "skipped",
      details: "Cannot evaluate trace with errors",
    };
  }

  // Determine if this is a thread-level evaluation
  // Use explicit level if provided, otherwise fall back to mapping detection for backward compatibility
  const isThreadLevel = level
    ? level === "thread"
    : hasThreadMappings(mappings);
  const evaluation_thread_id =
    isThreadLevel && trace.metadata?.thread_id
      ? trace.metadata.thread_id
      : undefined;

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
    evaluatorType: evaluatorType,
    data,
    settings: settings && typeof settings === "object" ? settings : undefined,
    trace,
    workflowId,
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
}: {
  projectId: string;
  evaluatorType: EvaluatorTypes | "workflow";
  data: DataForEvaluation;
  settings?: Record<string, unknown>;
  trace?: Trace;
  workflowId?: string | null;
  retries?: number;
}): Promise<SingleEvaluationResult> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId, archivedAt: null },
    include: { team: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const costChecker = createCostChecker(prisma);
  const maxMonthlyUsage = await costChecker.maxMonthlyUsageLimit(
    project.team.organizationId,
  );
  const getCurrentCost = await costChecker.getCurrentMonthCost(
    project.team.organizationId,
  );
  if (getCurrentCost >= maxMonthlyUsage) {
    return {
      status: "skipped",
      details: "Monthly usage limit exceeded",
    };
  }

  if (data.type === "custom") {
    return customEvaluation(
      projectId,
      evaluatorType,
      data.data,
      trace,
      workflowId,
    );
  }

  // At this point, evaluatorType is a built-in evaluator (not "workflow" or "custom/*")
  const builtInEvaluatorType = evaluatorType as EvaluatorTypes;
  const evaluator = AVAILABLE_EVALUATORS[builtInEvaluatorType];

  if (!evaluator) {
    throw new Error(`Evaluator ${evaluatorType} not found`);
  }

  let evaluatorEnv: Record<string, string> = Object.fromEntries(
    (evaluator.envVars ?? []).map((envVar) => [envVar, process.env[envVar]!]),
  );

  const setupModelEnv = async (
    model: string,
    embeddings: boolean,
    settings?: Record<string, unknown>,
  ) => {
    const modelProviders = await getProjectModelProviders(projectId);
    const provider = model.split("/")[0]!;
    const modelProvider = modelProviders[provider];
    if (!modelProvider) {
      throw `Provider ${provider} is not configured`;
    }
    if (!modelProvider.enabled) {
      throw new UserConfigError(`Provider ${provider} is not enabled`);
    }
    const model_ = model.split("/").slice(1).join("/");
    const modelList = embeddings
      ? modelProvider.embeddingsModels
      : modelProvider.models;
    if (modelList && modelList.length > 0 && !modelList.includes(model_)) {
      throw new UserConfigError(
        `Model ${model_} is not in the ${
          embeddings ? "embedding models" : "models"
        } list for ${provider}, please select another model for running this evaluation`,
      );
    }
    const params = await prepareLitellmParams({
      model,
      modelProvider,
      projectId,
    });

    let env = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        embeddings ? `X_LITELLM_EMBEDDINGS_${key}` : `X_LITELLM_${key}`,
        value,
      ]),
    );

    // Add generation params from settings (temperature, max_tokens, reasoning_effort, etc.)
    // These will be injected by litellm_patch.py in langevals
    const generationParams = [
      "temperature",
      "max_tokens",
      "top_p",
      "frequency_penalty",
      "presence_penalty",
      "seed",
      "reasoning_effort",
    ];
    for (const param of generationParams) {
      const value = settings?.[param];
      if (value !== undefined && value !== null) {
        const envKey = embeddings
          ? `X_LITELLM_EMBEDDINGS_${param}`
          : `X_LITELLM_${param}`;
        env[envKey] = String(value);
      }
    }

    // TODO: adapt embeddings_model_to_langchain on langevals to also use litellm and not need this
    if (embeddings) {
      env = { ...env, ...prepareEnvKeys(modelProvider) };
    }

    return env;
  };

  if (
    settings &&
    "model" in settings &&
    typeof settings.model === "string" &&
    builtInEvaluatorType !== "openai/moderation"
  ) {
    evaluatorEnv = {
      ...evaluatorEnv,
      ...(await setupModelEnv(settings.model, false, settings)),
    };
  }

  if (
    settings &&
    "embeddings_model" in settings &&
    typeof settings.embeddings_model === "string"
  ) {
    evaluatorEnv = {
      ...evaluatorEnv,
      ...(await setupModelEnv(settings.embeddings_model, true, settings)),
    };
  }

  const startTime = performance.now();

  let response;
  try {
    response = await fetch(
      `${env.LANGEVALS_ENDPOINT}/${builtInEvaluatorType}/evaluate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
        }),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("fetch failed")) {
      console.error({ error, path: `${env.LANGEVALS_ENDPOINT}/${builtInEvaluatorType}/evaluate` });
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
    } else {
      getEvaluationStatusCounter(builtInEvaluatorType, "error").inc();
      let statusText = response.statusText;
      try {
        statusText = JSON.stringify(await response.json(), undefined, 2);
      } catch {
        /* this is just a safe json parse fallback */
      }
      throw `${response.status} ${statusText}`;
    }
  }

  const result = ((await response.json()) as BatchEvaluationResult)[0];
  if (!result) {
    getEvaluationStatusCounter(builtInEvaluatorType, "error").inc();
    throw "Unexpected response: empty results";
  }

  getEvaluationStatusCounter(builtInEvaluatorType, result.status).inc();

  return result;
};

export const startEvaluationsWorker = (
  processFn: (
    job: Job<EvaluationJob, any, EvaluatorTypes>,
  ) => Promise<EvaluationResultWithThreadId>,
) => {
  if (!connection) {
    logger.info("no redis connection, skipping trace checks worker");
    return;
  }

  const traceChecksWorker = new Worker<EvaluationJob, any, EvaluatorTypes>(
    EVALUATIONS_QUEUE.NAME,
    withJobContext(
      async (job) => {
        recordJobWaitDuration(job, "evaluations");
        if (
          env.NODE_ENV !== "test" &&
          job.data.trace.trace_id.includes("test-trace")
        ) {
          return;
        }

        getJobProcessingCounter("evaluations", "processing").inc();
        const start = Date.now();

        try {
          logger.info({ jobId: job.id, data: job.data }, "processing job");

          let processed = false;
          const timeout = new Promise((resolve, reject) => {
            setTimeout(
              () => {
                if (processed) {
                  resolve(undefined);
                } else {
                  reject(new Error("Job timed out after 5 minutes"));
                }
              },
              5 * 60 * 1000,
            );
          });

          const result = (await Promise.race([
            processFn(job),
            timeout,
          ])) as EvaluationResultWithThreadId;
          processed = true;

          if ("cost" in result && result.cost) {
            await prisma.cost.create({
              data: {
                id: `cost_${nanoid()}`,
                projectId: job.data.trace.project_id,
                costType: CostType.TRACE_CHECK,
                costName: job.data.check.name,
                referenceType: CostReferenceType.CHECK,
                referenceId: job.data.check.evaluator_id,
                amount: result.cost.amount,
                currency: result.cost.currency,
                extraInfo: {
                  evaluation_id: job.data.check.evaluation_id,
                },
              },
            });
          }

          await updateEvaluationStatusInES({
            check: job.data.check,
            trace: job.data.trace,
            status: result.status,
            ...(result.evaluation_thread_id && {
              evaluation_thread_id: result.evaluation_thread_id,
            }),
            ...(result.inputs && { inputs: result.inputs }),
            ...(result.status === "error"
              ? {
                  error: {
                    message: result.details,
                    stack: result.traceback,
                  },
                }
              : {}),
            ...(result.status === "processed"
              ? {
                  score: result.score,
                  passed: result.passed,
                  label: result.label,
                }
              : {}),
            details: "details" in result ? (result.details ?? "") : "",
          });
          logger.info({ jobId: job.id }, "successfully processed job");

          const duration = Date.now() - start;
          getJobProcessingDurationHistogram("evaluations").observe(duration);
          getJobProcessingCounter("evaluations", "completed").inc();
        } catch (error) {
          await updateEvaluationStatusInES({
            check: job.data.check,
            trace: job.data.trace,
            status: "error",
            error: error,
          });
          // Note: Logging is handled by the 'failed' event handler to avoid double logging

          if (
            typeof error === "object" &&
            (error as any).message?.includes("504 Gateway Timeout")
          ) {
            throw error;
          }

          if (
            (typeof (error as any).status === "number" &&
              (error as any).status >= 400 &&
              (error as any).status < 500) ||
            (error as any).toString().startsWith("422")
          ) {
            throw error;
          }

          throw error;
        }
      },
    ),
    {
      connection,
      concurrency: 3,
      stalledInterval: 10 * 60 * 1000, // 10 minutes
      telemetry: new BullMQOtel(EVALUATIONS_QUEUE.NAME),
    },
  );

  traceChecksWorker.on("ready", () => {
    logger.info("trace worker active, waiting for jobs!");
  });

  traceChecksWorker.on("failed", async (job, err) => {
    getJobProcessingCounter("evaluations", "failed").inc();
    if (err instanceof UserConfigError) {
      logger.warn({ jobId: job?.id, error: err }, "job failed due to user configuration");
    } else {
      logger.error({ jobId: job?.id, error: err }, "job failed");
      await withScope((scope) => {
        scope.setTag?.("worker", "traceChecks");
        scope.setExtra?.("job", job?.data);
        captureException(err);
      });
    }
  });

  logger.info("trace checks worker registered");
  return traceChecksWorker;
};

const customEvaluation = async (
  projectId: string,
  evaluatorType: EvaluatorTypes | "workflow",
  data: Record<string, any>,
  trace?: Trace,
  workflowId?: string | null,
): Promise<SingleEvaluationResult> => {
  // For workflow evaluators (checkType "workflow"), workflowId comes from the evaluator record
  // For custom evaluators (checkType "custom/<workflowId>"), workflowId is parsed from the type
  const resolvedWorkflowId = workflowId ?? evaluatorType.split("/")[1];

  const project = await prisma.project.findUnique({
    where: { id: projectId, archivedAt: null },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const requestBody: Record<string, any> = {
    trace_id: trace?.trace_id,
    do_not_trace: true,
    ...data,
  };

  if (!resolvedWorkflowId) {
    throw new Error("Workflow ID is required");
  }

  const response = await runEvaluationWorkflow(
    resolvedWorkflowId,
    project.id,
    requestBody,
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

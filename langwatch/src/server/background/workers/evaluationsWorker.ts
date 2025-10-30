import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker, type Job } from "bullmq";
import { nanoid } from "nanoid";
import type { EvaluationJob } from "~/server/background/types";
import type { Trace } from "~/server/tracer/types";
import { env } from "../../../env.mjs";
import {
  AVAILABLE_EVALUATORS,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../../server/evaluations/evaluators.generated";
import {
  getCurrentMonthCost,
  maxMonthlyUsageLimit,
} from "../../api/routers/limits";
import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { prisma } from "../../db";
import {
  evaluationDurationHistogram,
  getEvaluationStatusCounter,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import {
  EVALUATIONS_QUEUE_NAME,
  updateEvaluationStatusInES,
} from "../queues/evaluationsQueue";

import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
} from "../../evaluations/evaluationMappings";
import {
  mapTraceToDatasetEntry,
  tryAndConvertTo,
  type MappingState,
  type TRACE_MAPPINGS,
  THREAD_MAPPINGS,
} from "../../tracer/tracesMapping";
import { runEvaluationWorkflow } from "../../workflows/runWorkflow";
import type { Protections } from "~/server/elasticsearch/protections";
import {
  getTraceById,
  getTracesGroupedByThreadId,
} from "~/server/elasticsearch/traces";
import { getProtectionsForProject } from "~/server/api/utils";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("langwatch:workers:evaluationsWorker");

export async function runEvaluationJob(
  job: Job<EvaluationJob, any, string>,
): Promise<EvaluationResultWithThreadId> {
  const check = await prisma.monitor.findUnique({
    where: {
      id: job.data.check.evaluator_id,
      projectId: job.data.trace.project_id,
    },
  });
  if (!check) {
    throw `check config ${job.data.check.evaluator_id} not found`;
  }

  const protections = await getProtectionsForProject(prisma, {
    projectId: job.data.trace.project_id,
  });

  return await runEvaluationForTrace({
    projectId: job.data.trace.project_id,
    traceId: job.data.trace.trace_id,
    evaluatorType: job.data.check.type,
    settings: check.parameters,
    mappings: check.mappings as MappingState | null,
    protections,
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
    throw new Error(
      "Trace does not have a thread_id for thread-based evaluation",
    );
  }

  logger.info({
    threadId,
    traceId: trace.trace_id,
    projectId,
  }, "Fetching thread traces");

  // Fetch all traces in the thread
  const threadTraces = await getTracesGroupedByThreadId({
    connConfig: { projectId },
    threadId,
    protections,
    includeSpans: true,
  });

  logger.info({
    threadId,
    traceCount: threadTraces.length,
    traceIds: threadTraces.map((t) => t.trace_id),
  }, "Thread traces fetched");

  const result: Record<string, any> = {};

  // Process each mapping
  for (const [targetField, mappingConfig] of Object.entries(
    mappingState.mapping,
  )) {
    if ("type" in mappingConfig && mappingConfig.type === "thread") {
      const source = mappingConfig.source;

      // Skip empty source
      if (!source) {
        continue;
      }

      // Use the mapping function from THREAD_MAPPINGS dynamically
      const selectedFields = mappingConfig.selectedFields ?? [];
      result[targetField] = THREAD_MAPPINGS[source].mapping(
        { thread_id: threadId, traces: threadTraces },
        selectedFields as (keyof typeof TRACE_MAPPINGS)[],
      );

      logger.info({
        targetField,
        source,
        ...(selectedFields.length > 0 && { selectedFields }),
        ...(source === "traces" && {
          traceCount: (result[targetField] as any[]).length,
        }),
      }, "Mapped thread field");
    } else {
      // Regular trace mapping - use current trace
      // Type guard ensures mappingConfig.source is from TRACE_MAPPINGS
      if ("source" in mappingConfig) {
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
        logger.info({
          targetField,
          source: mappingConfig.source,
          value:
            typeof result[targetField] === "string"
              ? result[targetField].substring(0, 100) + "..."
              : result[targetField],
        }, "Mapped trace field");
      }
    }
  }

  logger.info({
    threadId,
    resultKeys: Object.keys(result),
  }, "Thread data build complete");

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
  evaluatorType: EvaluatorTypes,
  trace: Trace,
  mappings: MappingState | null,
  projectId: string,
  protections: Protections,
): Promise<DataForEvaluation> => {
  let data: Record<string, any>;

  // Check if we have thread mappings
  const hasThread = hasThreadMappings(mappings);

  logger.info({
    evaluatorType,
    traceId: trace.trace_id,
    threadId: trace.metadata?.thread_id,
    hasThreadMappings: hasThread,
    mappingKeys: mappings ? Object.keys(mappings.mapping) : [],
  }, "Building data for evaluation");

  if (hasThread) {
    // Use thread-based data extraction
    logger.info({
      traceId: trace.trace_id,
      threadId: trace.metadata?.thread_id,
    }, "Using thread-based data extraction");
    data = await buildThreadData(projectId, trace, mappings, protections);
  } else {
    // Use regular trace-based mapping
    logger.info({
      traceId: trace.trace_id,
    }, "Using regular trace-based mapping");
    const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
    if (!mappedData) {
      throw new Error("No mapped data found to run evaluator");
    }
    data = mappedData;
  }

  if (evaluatorType.startsWith("custom/")) {
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
  protections,
}: {
  projectId: string;
  traceId: string;
  evaluatorType: EvaluatorTypes;
  settings: Record<string, any> | string | number | boolean | null;
  mappings: MappingState | null;
  protections: Protections;
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

  if (trace.error) {
    return {
      status: "skipped",
      details: "Cannot evaluate trace with errors",
    };
  }

  // Check if thread mappings are used and track the thread_id
  const hasThread = hasThreadMappings(mappings);
  const evaluation_thread_id =
    hasThread && trace.metadata?.thread_id
      ? trace.metadata.thread_id
      : undefined;

  const data = await buildDataForEvaluation(
    evaluatorType,
    trace,
    mappings,
    projectId,
    protections,
  );

  const result = await runEvaluation({
    projectId,
    evaluatorType: evaluatorType,
    data,
    settings: settings && typeof settings === "object" ? settings : undefined,
    trace,
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
  retries = 1,
}: {
  projectId: string;
  evaluatorType: EvaluatorTypes;
  data: DataForEvaluation;
  settings?: Record<string, unknown>;
  trace?: Trace;
  retries?: number;
}): Promise<SingleEvaluationResult> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId, archivedAt: null },
    include: { team: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const maxMonthlyUsage = await maxMonthlyUsageLimit(
    project.team.organizationId,
  );
  const getCurrentCost = await getCurrentMonthCost(project.team.organizationId);
  if (getCurrentCost >= maxMonthlyUsage) {
    return {
      status: "skipped",
      details: "Monthly usage limit exceeded",
    };
  }

  if (data.type === "custom") {
    return customEvaluation(projectId, evaluatorType, data.data, trace);
  }

  const evaluator = AVAILABLE_EVALUATORS[evaluatorType];

  if (!evaluator) {
    throw new Error(`Evaluator ${evaluatorType} not found`);
  }

  let evaluatorEnv: Record<string, string> = Object.fromEntries(
    (evaluator.envVars ?? []).map((envVar) => [envVar, process.env[envVar]!]),
  );

  const setupModelEnv = async (model: string, embeddings: boolean) => {
    const modelProviders = await getProjectModelProviders(projectId);
    const provider = model.split("/")[0]!;
    const modelProvider = modelProviders[provider];
    if (!modelProvider) {
      throw `Provider ${provider} is not configured`;
    }
    if (!modelProvider.enabled) {
      throw `Provider ${provider} is not enabled`;
    }
    const model_ = model.split("/").slice(1).join("/");
    const modelList = embeddings
      ? modelProvider.embeddingsModels
      : modelProvider.models;
    if (modelList && modelList.length > 0 && !modelList.includes(model_)) {
      throw `Model ${model_} is not in the ${
        embeddings ? "embedding models" : "models"
      } list for ${provider}, please select another model for running this evaluation`;
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
    evaluatorType !== "openai/moderation"
  ) {
    evaluatorEnv = {
      ...evaluatorEnv,
      ...(await setupModelEnv(settings.model, false)),
    };
  }

  if (
    settings &&
    "embeddings_model" in settings &&
    typeof settings.embeddings_model === "string"
  ) {
    evaluatorEnv = {
      ...evaluatorEnv,
      ...(await setupModelEnv(settings.embeddings_model, true)),
    };
  }

  const startTime = performance.now();

  let response;
  try {
    response = await fetch(
      `${env.LANGEVALS_ENDPOINT}/${evaluatorType}/evaluate`,
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
      throw new Error("Evaluator cannot be reached");
    }
    throw error;
  }

  const duration = performance.now() - startTime;
  evaluationDurationHistogram.labels(evaluatorType).observe(duration);

  if (!response.ok) {
    if (response.status >= 500 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return runEvaluation({
        projectId,
        evaluatorType: evaluatorType,
        data,
        settings,
        retries: retries - 1,
      });
    } else {
      getEvaluationStatusCounter(evaluatorType, "error").inc();
      let statusText = response.statusText;
      try {
        statusText = JSON.stringify(await response.json(), undefined, 2);
      } catch {}
      throw `${response.status} ${statusText}`;
    }
  }

  const result = ((await response.json()) as BatchEvaluationResult)[0];
  if (!result) {
    getEvaluationStatusCounter(evaluatorType, "error").inc();
    throw "Unexpected response: empty results";
  }

  getEvaluationStatusCounter(evaluatorType, result.status).inc();

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
    EVALUATIONS_QUEUE_NAME,
    async (job) => {
      if (
        env.NODE_ENV !== "test" &&
        job.data.trace.trace_id.includes("test-trace")
      ) {
        return;
      }

      getJobProcessingCounter("evaluation", "processing").inc();
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
          details: "details" in result ? result.details ?? "" : "",
        });
        logger.info({ jobId: job.id }, "successfully processed job");

        const duration = Date.now() - start;
        getJobProcessingDurationHistogram("evaluation").observe(duration);
        getJobProcessingCounter("evaluation", "completed").inc();
      } catch (error) {
        await updateEvaluationStatusInES({
          check: job.data.check,
          trace: job.data.trace,
          status: "error",
          error: error,
        });
        logger.error({ jobId: job.id, error }, "failed to process job");

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
    {
      connection,
      concurrency: 3,
      stalledInterval: 10 * 60 * 1000, // 10 minutes
    },
  );

  traceChecksWorker.on("ready", () => {
    logger.info("trace worker active, waiting for jobs!");
  });

  traceChecksWorker.on("failed", (job, err) => {
    getJobProcessingCounter("evaluation", "failed").inc();
    logger.error({ jobId: job?.id, error: err }, "job failed");
    Sentry.withScope((scope) => {
      scope.setTag("worker", "traceChecks");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  logger.info("trace checks worker registered");
  return traceChecksWorker;
};

const customEvaluation = async (
  projectId: string,
  evaluatorType: EvaluatorTypes,
  data: Record<string, any>,
  trace?: Trace,
): Promise<SingleEvaluationResult> => {
  const workflowId = evaluatorType.split("/")[1];

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

  if (!workflowId) {
    throw new Error("Workflow ID is required");
  }

  const response = await runEvaluationWorkflow(
    workflowId,
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

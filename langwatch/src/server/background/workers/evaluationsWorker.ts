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
import { getDebugger } from "../../../utils/logger";
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
} from "../../tracer/tracesMapping";
import { runEvaluationWorkflow } from "../../workflows/runWorkflow";
import type { Protections } from "~/server/elasticsearch/protections";
import { getTraceById } from "~/server/elasticsearch/traces";
import { getProtectionsForProject } from "~/server/api/utils";

const debug = getDebugger("langwatch:workers:evaluationsWorker");

export async function runEvaluationJob(
  job: Job<EvaluationJob, any, string>
): Promise<SingleEvaluationResult> {
  const check = await prisma.monitor.findUnique({
    where: {
      id: job.data.check.evaluator_id,
      projectId: job.data.trace.project_id,
    },
  });
  if (!check) {
    throw `check config ${job.data.check.evaluator_id} not found`;
  }

  const protections = await getProtectionsForProject(prisma, { projectId: job.data.trace.project_id });

  return await runEvaluationForTrace({
    projectId: job.data.trace.project_id,
    traceId: job.data.trace.trace_id,
    evaluatorType: job.data.check.type,
    settings: check.parameters,
    mappings: check.mappings as MappingState,
    protections,
  });
}

const switchMapping = (
  trace: Trace,
  mapping_: MappingState
): Record<string, string | number> | undefined => {
  const mapping = !mapping_
    ? DEFAULT_MAPPINGS
    : "mapping" in mapping_
    ? mapping_
    : migrateLegacyMappings(mapping_ as any);

  return mapTraceToDatasetEntry(
    trace,
    mapping.mapping,
    new Set(),
    undefined
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

const buildDataForEvaluation = async (
  evaluatorType: EvaluatorTypes,
  trace: Trace,
  mappings: MappingState
): Promise<DataForEvaluation> => {
  const data = switchMapping(trace, mappings);
  if (!data) {
    throw new Error("No mapped data found to run evaluator");
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
      fields.map((field) => [field, data[field] ?? ""])
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
  mappings: MappingState;
  protections: Protections;
  }): Promise<SingleEvaluationResult> => {
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

  const data = await buildDataForEvaluation(evaluatorType, trace, mappings);

  const result = await runEvaluation({
    projectId,
    evaluatorType: evaluatorType,
    data,
    settings: settings && typeof settings === "object" ? settings : undefined,
    trace,
  });

  return result;
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
    where: { id: projectId },
    include: { team: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const maxMonthlyUsage = await maxMonthlyUsageLimit(
    project.team.organizationId
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
    (evaluator.envVars ?? []).map((envVar) => [envVar, process.env[envVar]!])
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
    if (modelList && !modelList.includes(model_)) {
      throw `Model ${model_} is not in the ${
        embeddings ? "embedding models" : "models"
      } list for ${provider}, please select another model for running this evaluation`;
    }
    const params = prepareLitellmParams(model, modelProvider);

    let env = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        embeddings ? `LITELLM_EMBEDDINGS_${key}` : `LITELLM_${key}`,
        value,
      ])
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
                "string[]"
              ),
              expected_output: tryAndConvertTo(
                data.data.expected_output,
                "string"
              ),
              conversation: tryAndConvertTo(data.data.conversation, "array"),
            },
          ],
          settings: settings && typeof settings === "object" ? settings : {},
          env: evaluatorEnv,
        }),
      }
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
    job: Job<EvaluationJob, any, EvaluatorTypes>
  ) => Promise<SingleEvaluationResult>
) => {
  if (!connection) {
    debug("No redis connection, skipping trace checks worker");
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
        debug(`Processing job ${job.id} with data::`, job.data);

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
            5 * 60 * 1000
          );
        });

        const result = (await Promise.race([
          processFn(job),
          timeout,
        ])) as SingleEvaluationResult;
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
        debug("Successfully processed job:", job.id);

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
        debug("Failed to process job::", job.id, error);

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
    }
  );

  traceChecksWorker.on("ready", () => {
    debug("Trace worker active, waiting for jobs!");
  });

  traceChecksWorker.on("failed", (job, err) => {
    getJobProcessingCounter("evaluation", "failed").inc();
    debug(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.withScope((scope) => {
      scope.setTag("worker", "traceChecks");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  debug("Trace checks worker registered");
  return traceChecksWorker;
};

const customEvaluation = async (
  projectId: string,
  evaluatorType: EvaluatorTypes,
  data: Record<string, any>,
  trace?: Trace
): Promise<SingleEvaluationResult> => {
  const workflowId = evaluatorType.split("/")[1];

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
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
    requestBody
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

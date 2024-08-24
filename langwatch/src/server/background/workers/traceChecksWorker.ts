import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker, type Job } from "bullmq";
import { nanoid } from "nanoid";
import type { TraceCheckJob } from "~/server/background/types";
import { env } from "../../../env.mjs";
import {
  AVAILABLE_EVALUATORS,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../../trace_checks/evaluators.generated";
import { getDebugger } from "../../../utils/logger";
import {
  getCurrentMonthCost,
  maxMonthlyUsageLimit,
} from "../../api/routers/limits";
import {
  getProjectModelProviders,
  prepareEnvKeys,
} from "../../api/routers/modelProviders";
import {
  esGetSpansByTraceId,
  getTraceById,
  getTracesByThreadId,
} from "../../api/routers/traces";
import { prisma } from "../../db";
import { connection } from "../../redis";
import { getRAGInfo } from "../../tracer/utils";
import {
  TRACE_CHECKS_QUEUE_NAME,
  updateCheckStatusInES,
} from "../queues/traceChecksQueue";

const debug = getDebugger("langwatch:workers:traceChecksWorker");

export const runEvaluationJob = async (
  job: Job<TraceCheckJob, any, EvaluatorTypes>
): Promise<SingleEvaluationResult> => {
  const check = await prisma.check.findUnique({
    where: {
      id: job.data.check.evaluator_id,
      projectId: job.data.trace.project_id,
    },
  });
  if (!check) {
    throw `check config ${job.data.check.evaluator_id} not found`;
  }

  return await runEvaluationForTrace({
    projectId: job.data.trace.project_id,
    traceId: job.data.trace.trace_id,
    evaluatorType: job.data.check.type,
    settings: check.parameters,
  });
};

type Conversation = {
  input?: string;
  output?: string;
}[];

export const runEvaluationForTrace = async ({
  projectId,
  traceId,
  evaluatorType,
  settings,
}: {
  projectId: string;
  traceId: string;
  evaluatorType: EvaluatorTypes;
  settings: Record<string, any> | string | number | boolean | null;
}): Promise<SingleEvaluationResult> => {
  const evaluator = AVAILABLE_EVALUATORS[evaluatorType];

  const trace = await getTraceById({
    projectId,
    traceId,
  });
  const spans = await esGetSpansByTraceId({
    traceId: traceId,
    projectId: projectId,
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

  const input = trace.input?.value;
  const output = trace.output?.value;
  const expected_output = trace.expected_output?.value;

  let contexts = undefined;
  if (evaluator.requiredFields.includes("contexts")) {
    const ragInfo = getRAGInfo(spans);
    contexts = ragInfo.contexts;
  }

  const threadId = trace.metadata.thread_id;
  const fullThread = threadId
    ? await getTracesByThreadId({
        threadId: threadId,
        projectId: projectId,
      })
    : undefined;
  const currentMessageIndex = fullThread?.findIndex(
    (message) => message.trace_id === trace.trace_id
  );
  const conversation: Conversation = fullThread
    ?.slice(0, currentMessageIndex)
    .map((message) => ({
      input: message.input?.value,
      output: message.output?.value,
    })) ?? [
    {
      input: trace.input?.value,
      output: trace.output?.value,
    },
  ];

  const result = await runEvaluation({
    projectId,
    checkType: evaluatorType,
    input,
    output,
    contexts,
    expected_output,
    conversation,
    settings: settings && typeof settings === "object" ? settings : undefined,
  });

  return result;
};

export const runEvaluation = async ({
  projectId,
  checkType,
  input,
  output,
  contexts,
  expected_output,
  settings,
  conversation,
  retries = 1,
}: {
  projectId: string;
  checkType: EvaluatorTypes;
  input?: string;
  output?: string;
  contexts?: string[];
  expected_output?: string;
  conversation?: Conversation;
  settings?: Record<string, unknown>;
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

  let evaluatorEnv: Record<string, string> = {};

  const setupEnv = async (model: string) => {
    const modelProviders = await getProjectModelProviders(projectId);
    const provider = model.split("/")[0]!;
    const modelProvider = modelProviders[provider];
    if (!modelProvider) {
      throw `Provider ${provider} is not configured`;
    }
    if (!modelProvider.enabled) {
      throw `Provider ${provider} is not enabled`;
    }
    return prepareEnvKeys(modelProvider);
  };

  if (
    settings &&
    "model" in settings &&
    typeof settings.model === "string" &&
    checkType !== "openai/moderation"
  ) {
    evaluatorEnv = await setupEnv(settings.model);
  }

  if (
    settings &&
    "embeddings_model" in settings &&
    typeof settings.embeddings_model === "string"
  ) {
    evaluatorEnv = await setupEnv(settings.embeddings_model);
  }

  const response = await fetch(
    `${env.LANGEVALS_ENDPOINT}/${checkType}/evaluate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [
          {
            input: input ?? "",
            output: output ?? "",
            contexts: contexts ?? [],
            expected_output: expected_output ?? "",
            conversation: conversation ?? [],
          },
        ],
        settings: settings && typeof settings === "object" ? settings : {},
        env: evaluatorEnv,
      }),
    }
  );

  if (!response.ok) {
    if (response.status >= 500 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return runEvaluation({
        projectId,
        checkType,
        input,
        output,
        contexts,
        expected_output,
        conversation,
        settings,
        retries: retries - 1,
      });
    } else {
      let statusText = response.statusText;
      try {
        statusText = JSON.stringify(await response.json(), undefined, 2);
      } catch {}
      throw `${response.status} ${statusText}`;
    }
  }

  const result = ((await response.json()) as BatchEvaluationResult)[0];
  if (!result) {
    throw "Unexpected response: empty results";
  }

  return result;
};

export const startTraceChecksWorker = (
  processFn: (
    job: Job<TraceCheckJob, any, EvaluatorTypes>
  ) => Promise<SingleEvaluationResult>
) => {
  if (!connection) {
    debug("No redis connection, skipping trace checks worker");
    return;
  }

  const traceChecksWorker = new Worker<TraceCheckJob, any, EvaluatorTypes>(
    TRACE_CHECKS_QUEUE_NAME,
    async (job) => {
      if (
        env.NODE_ENV !== "test" &&
        job.data.trace.trace_id.includes("test-trace")
      ) {
        return;
      }

      try {
        debug(`Processing job ${job.id} with data:`, job.data);

        let processed = false;
        const timeout = new Promise((resolve, reject) => {
          setTimeout(() => {
            if (processed) {
              resolve(undefined);
            } else {
              reject(new Error("Job timed out after 60s"));
            }
          }, 60_000);
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

        await updateCheckStatusInES({
          check: job.data.check,
          trace: job.data.trace,
          status: result.status,
          ...(result.status === "error"
            ? {
                error: {
                  message: result.message,
                  stack: result.traceback,
                },
              }
            : {}),
          ...(result.status === "processed"
            ? {
                score: result.score,
                passed: result.passed,
              }
            : {}),
          details: "details" in result ? result.details ?? "" : "",
        });
        debug("Successfully processed job:", job.id);
      } catch (error) {
        await updateCheckStatusInES({
          check: job.data.check,
          trace: job.data.trace,
          status: "error",
          error: error,
        });
        debug("Failed to process job:", job.id, error);

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

        // Ragas evaluations are expensive
        const isEvaluationRetriable = !job.data.check.type.includes("ragas/");

        if (isEvaluationRetriable) {
          throw error;
        }
      }
    },
    {
      connection,
      concurrency: 3,
      stalledInterval: 60_000, // 1 minute
    }
  );

  traceChecksWorker.on("ready", () => {
    debug("Trace worker active, waiting for jobs!");
  });

  traceChecksWorker.on("failed", (job, err) => {
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

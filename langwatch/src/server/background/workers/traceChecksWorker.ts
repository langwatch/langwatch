import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker, type Job } from "bullmq";
import { nanoid } from "nanoid";
import { env } from "../../../env.mjs";
import type { TraceCheckJob } from "~/server/background/types";
import { prisma } from "../../db";
import { connection } from "../../redis";
import {
  TRACE_CHECKS_QUEUE_NAME,
  updateCheckStatusInES,
} from "../queues/traceChecksQueue";
import { getDebugger } from "../../../utils/logger";
import {
  AVAILABLE_EVALUATORS,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../../trace_checks/evaluators.generated";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import type { Trace } from "../../tracer/types";
import { esGetSpansByTraceId } from "../../api/routers/traces";
import { getRAGInfo } from "../../tracer/utils";

const debug = getDebugger("langwatch:workers:traceChecksWorker");

export const runEvaluation = async (
  job: Job<TraceCheckJob, any, EvaluatorTypes>
): Promise<SingleEvaluationResult> => {
  const evaluator = AVAILABLE_EVALUATORS[job.data.check.type];
  const check = await prisma.check.findUnique({
    where: { id: job.data.check.id },
  });
  if (!check) {
    throw `check config ${job.data.check.id} not found`;
  }

  const trace = await esClient.getSource<Trace>({
    index: TRACE_INDEX,
    id: traceIndexId({
      traceId: job.data.trace.trace_id,
      projectId: job.data.trace.project_id,
    }),
  });
  const spans = await esGetSpansByTraceId({
    traceId: job.data.trace.trace_id,
    projectId: job.data.trace.project_id,
  });
  if (!trace) {
    throw "trace not found";
  }

  let input = trace.input.value;
  let output = trace.output?.value;
  let contexts = undefined;

  if (evaluator.requiredFields.includes("contexts")) {
    const ragInfo = getRAGInfo(spans);
    input = ragInfo.input ?? input;
    output = ragInfo.output ?? output;
    contexts = ragInfo.contexts;
  }

  const response = await fetch(
    `${env.LANGEVALS_ENDPOINT}/${job.data.check.type}/evaluate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [{ input, output, contexts }],
        settings: check.parameters,
      }),
    }
  );

  if (!response.ok) {
    throw `${response.status} ${response.statusText}`;
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

        const timeout = setTimeout(() => {
          throw new Error("Job timed out after 60s");
        }, 60_000);

        const result = await processFn(job);
        clearTimeout(timeout);

        if ("cost" in result && result.cost) {
          await prisma.cost.create({
            data: {
              id: `cost_${nanoid()}`,
              projectId: job.data.trace.project_id,
              costType: CostType.TRACE_CHECK,
              costName: job.data.check.name,
              referenceType: CostReferenceType.CHECK,
              referenceId: job.data.check.id,
              amount: result.cost.amount,
              currency: result.cost.currency,
              extraInfo: {
                trace_check_id: job.id,
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
          "message" in (error as any) &&
          (error as any).message.includes("504 Gateway Timeout")
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
    Sentry.captureException(err);
  });

  debug("Trace checks worker registered");
  return traceChecksWorker;
};

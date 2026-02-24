import type { ConnectionOptions, Job } from "bullmq";
import {
  type EvaluationJob,
  getEvaluationId,
  getEvaluatorId,
} from "~/server/background/types";
import { traceCheckIndexId } from "~/server/elasticsearch";
import { captureError } from "../../../utils/captureError";
import { createLogger } from "../../../utils/logger/server";
import { safeTruncate } from "../../../utils/truncate";
import { esClient, TRACE_INDEX, traceIndexId } from "../../elasticsearch";
import { connection } from "../../redis";
import type { ElasticSearchEvaluation } from "../../tracer/types";
import { EVALUATIONS_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { EVALUATIONS_QUEUE } from "./constants";

const logger = createLogger("langwatch:evaluations:queue");

/**
 * Register pattern: the fallback worker is set by evaluationsWorker.ts at startup.
 * This avoids a circular import (evaluationsQueue ↔ evaluationsWorker).
 */
let fallbackWorkerFn: ((job: Job<EvaluationJob, any, string>) => Promise<any>) | null = null;

export const registerEvaluationsFallbackWorker = (
  fn: (job: Job<EvaluationJob, any, string>) => Promise<any>,
) => {
  fallbackWorkerFn = fn;
};

// Note: Job name is dynamic (evaluator type), not a constant
export const evaluationsQueue = new QueueWithFallback<
  EvaluationJob,
  any,
  string
>(
  EVALUATIONS_QUEUE.NAME,
  async (job) => {
    if (!fallbackWorkerFn) {
      throw new Error("Evaluations fallback worker not registered");
    }
    return fallbackWorkerFn(job);
  },
  {
    connection: connection as ConnectionOptions,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      attempts: 3,
      removeOnComplete: {
        age: 60 * 60, // Remove in 1 hour to prevent accidental reruns
      },
      removeOnFail: {
        age: 60 * 60 * 24 * 3, // 3 days
      },
    },
  },
);

/**
 * Thread debounce configuration for thread-level evaluations.
 * When set, the evaluation will be debounced per thread - each new message
 * in a thread resets the timer, and the evaluation only runs after the
 * thread has been idle for timeoutSeconds.
 */
export type ThreadDebounceConfig = {
  threadId: string;
  timeoutSeconds: number;
};

/**
 * Generate a job ID for thread-based debouncing.
 * Uses threadId + checkId so all messages in a thread share the same job.
 */
const threadCheckIndexId = ({
  threadId,
  checkId,
  projectId,
}: {
  threadId: string;
  checkId: string;
  projectId: string;
}): string => {
  return `thread_${projectId}_${threadId}_${checkId}`;
};

export const scheduleEvaluation = async ({
  check,
  trace,
  delay,
  threadDebounce,
}: {
  check: EvaluationJob["check"];
  trace: EvaluationJob["trace"];
  delay?: number;
  /** Thread-based debouncing configuration. When set, delays evaluation until thread is idle. */
  threadDebounce?: ThreadDebounceConfig;
}) => {
  await updateEvaluationStatusInES({
    check,
    trace: trace,
    status: "scheduled",
  });

  // For thread debouncing, use thread-based job ID; otherwise use trace-based
  const jobId = threadDebounce
    ? threadCheckIndexId({
        threadId: threadDebounce.threadId,
        checkId: check.evaluator_id,
        projectId: trace.project_id,
      })
    : traceCheckIndexId({
        traceId: trace.trace_id,
        checkId: check.evaluator_id,
        projectId: trace.project_id,
      });

  // Calculate delay: for thread debouncing use the configured timeout, otherwise default 30s
  const effectiveDelay = threadDebounce
    ? threadDebounce.timeoutSeconds * 1000
    : (delay ?? 30_000);

  const currentJob = await evaluationsQueue.getJob(jobId);
  if (currentJob) {
    const state = await currentJob.getState();

    if (threadDebounce && (state === "waiting" || state === "delayed")) {
      // Thread debouncing: remove existing job and reschedule with fresh delay
      // This "resets the timer" when a new message arrives in the thread
      const previousJobData = currentJob.data as EvaluationJob;
      logger.info(
        {
          check,
          trace,
          threadId: threadDebounce.threadId,
          state,
          previousTraceId: previousJobData?.trace?.trace_id,
        },
        "thread debounce: resetting timer for thread evaluation",
      );

      // Update the previous trace's evaluation status to "skipped" since it's being superseded
      if (
        previousJobData?.trace &&
        previousJobData.trace.trace_id !== trace.trace_id
      ) {
        try {
          await updateEvaluationStatusInES({
            check: previousJobData.check,
            trace: previousJobData.trace,
            status: "skipped",
            details: "Superseded by newer message in thread",
          });
        } catch (error) {
          logger.warn(
            { error, previousTraceId: previousJobData.trace.trace_id },
            "Failed to update previous trace evaluation status to skipped",
          );
        }
      }

      try {
        await currentJob.remove();
      } catch {
        // Job might have been processed in the meantime, ignore
      }
      // Fall through to schedule new job
    } else if (state === "failed" || state === "completed") {
      logger.info({ check, trace, state }, "retrying");
      await currentJob.retry(state);
      return;
    } else {
      // Job exists and is not in a state we should replace (active, etc.)
      logger.info({ check, trace, state }, "job already exists, skipping");
      return;
    }
  }

  logger.info(
    {
      check,
      trace,
      delay: effectiveDelay,
      ...(threadDebounce && {
        threadDebounce: true,
        threadId: threadDebounce.threadId,
      }),
    },
    "scheduling",
  );
  await evaluationsQueue.add(
    check.type,
    {
      // Recreating the check object to avoid passing the whole check object and making the queue heavy, we pass only the keys we need
      check: {
        evaluation_id: check.evaluation_id,
        evaluator_id: check.evaluator_id,
        type: check.type,
        name: check.name,
      },
      // Recreating the trace object to avoid passing the whole trace object and making the queue heavy, we pass only the keys we need
      trace: {
        trace_id: trace.trace_id,
        project_id: trace.project_id,
        thread_id: trace.thread_id,
        user_id: trace.user_id,
        customer_id: trace.customer_id,
        labels: trace.labels,
      },
    },
    {
      jobId,
      delay: effectiveDelay,
    },
  );
};

export const updateEvaluationStatusInES = async ({
  check,
  trace,
  status,
  score,
  passed,
  label,
  error,
  details,
  retries,
  is_guardrail,
  evaluation_thread_id,
  inputs,
}: {
  check: EvaluationJob["check"];
  trace: EvaluationJob["trace"];
  status: ElasticSearchEvaluation["status"];
  error?: any;
  score?: number;
  passed?: boolean;
  label?: string;
  details?: string;
  retries?: number;
  is_guardrail?: boolean;
  evaluation_thread_id?: string;
  inputs?: Record<string, any>;
}) => {
  const evaluation: ElasticSearchEvaluation = {
    evaluation_id: getEvaluationId(check),
    evaluator_id: getEvaluatorId(check),
    thread_id: trace.thread_id,
    user_id: trace.user_id,
    customer_id: trace.customer_id,
    labels: trace.labels,
    type: check.type,
    status,
    ...(check.name && { name: check.name }),
    ...(is_guardrail !== undefined && { is_guardrail }),
    ...(evaluation_thread_id && { evaluation_thread_id }),
    ...(typeof score === "number" && { score }),
    ...(passed !== undefined && { passed }),
    ...(label !== undefined && { label }),
    ...(error && { error: captureError(error) }),
    ...(details !== undefined && { details }),
    ...(retries && { retries }),
    ...(inputs && { inputs: safeTruncate(inputs, 32 * 1024) }),
    timestamps: {
      ...(status == "in_progress" && { started_at: Date.now() }),
      ...((status == "skipped" || status == "processed") && {
        finished_at: Date.now(),
      }),
      updated_at: Date.now(),
    },
  };

  // Random delay to avoid elasticsearch update collisions
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));

  const client = await esClient({ projectId: trace.project_id });
  await client.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({
      traceId: trace.trace_id,
      projectId: trace.project_id,
    }),
    retry_on_conflict: 10,
    body: {
      script: {
        source: `
          if (ctx._source.evaluations == null) {
            ctx._source.evaluations = [];
          }
          def newEvaluation = params.newEvaluation;
          def found = false;
          for (int i = 0; i < ctx._source.evaluations.size(); i++) {
            if (ctx._source.evaluations[i].evaluation_id == newEvaluation.evaluation_id) {
              ctx._source.evaluations[i] = newEvaluation;
              found = true;
              break;
            }
          }
          if (!found) {
            if (newEvaluation.timestamps == null) {
              newEvaluation.timestamps = new HashMap();
            }
            newEvaluation.timestamps.inserted_at = System.currentTimeMillis();
            ctx._source.evaluations.add(newEvaluation);
          }
        `,
        lang: "painless",
        params: {
          newEvaluation: evaluation,
        },
      },
      upsert: {
        trace_id: trace.trace_id,
        project_id: trace.project_id,
        timestamps: {
          inserted_at: Date.now(),
          started_at: Date.now(),
          updated_at: Date.now(),
        },
        evaluations: [evaluation],
      },
    },
    refresh: true,
  });

};

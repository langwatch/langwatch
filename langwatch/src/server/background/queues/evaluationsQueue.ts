import type { EvaluationJob } from "~/server/background/types";
import { traceCheckIndexId } from "~/server/elasticsearch";
import { captureError } from "../../../utils/captureError";
import { esClient, TRACE_INDEX, traceIndexId } from "../../elasticsearch";
import { connection } from "../../redis";
import type { ElasticSearchEvaluation } from "../../tracer/types";
import { getDebugger } from "../../../utils/logger";
import { QueueWithFallback, scheduleWithFallback } from "./queueWithFallback";
import { runEvaluationJob } from "../workers/evaluationsWorker";
import type { ConnectionOptions } from "bullmq";

export const EVALUATIONS_QUEUE_NAME = "evaluations";

const debug = getDebugger("langwatch:evaluations:queue");

export const evaluationsQueue = new QueueWithFallback<
  EvaluationJob,
  any,
  string
>(EVALUATIONS_QUEUE_NAME, runEvaluationJob, {
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
});

export const scheduleEvaluation = async ({
  check,
  trace,
  delay,
}: {
  check: EvaluationJob["check"];
  trace: EvaluationJob["trace"];
  delay?: number;
}) => {
  await updateEvaluationStatusInES({
    check,
    trace: trace,
    status: "scheduled",
  });

  const jobId = traceCheckIndexId({
    traceId: trace.trace_id,
    checkId: check.evaluator_id,
    projectId: trace.project_id,
  });
  const currentJob = await evaluationsQueue.getJob(jobId);
  if (currentJob) {
    const state = await currentJob.getState();
    if (state == "failed" || state == "completed") {
      debug(
        `retrying ${check.type} (checkId: ${check.evaluator_id}) for trace ${trace.trace_id}`
      );
      await currentJob.retry(state);
    }
  } else {
    debug(
      `scheduling ${check.type} (checkId: ${check.evaluator_id}) for trace ${trace.trace_id}`
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
        // Add a little delay to wait for the spans to be fully collected
        delay: delay ?? 4000,
      }
    );
  }
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
}) => {
  const evaluation: ElasticSearchEvaluation = {
    evaluation_id: check.evaluation_id ?? (check as any).id,
    evaluator_id: check.evaluator_id ?? (check as any).id,
    thread_id: trace.thread_id,
    user_id: trace.user_id,
    customer_id: trace.customer_id,
    labels: trace.labels,
    type: check.type,
    status,
    ...(check.name && { name: check.name }),
    ...(is_guardrail !== undefined && { is_guardrail }),
    ...(score !== undefined && { score }),
    ...(passed !== undefined && { passed }),
    ...(label !== undefined && { label }),
    ...(error && { error: captureError(error) }),
    ...(details !== undefined && { details }),
    ...(retries && { retries }),
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

  await esClient.update({
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

import { Queue } from "bullmq";
import { connection } from "../../redis";
import { captureError } from "../../../utils/captureError";
import { esClient, TRACE_CHECKS_INDEX } from "../../elasticsearch";
import type { TraceCheck } from "../../tracer/types";
import type { TraceCheckJob } from "~/server/background/types";
import { traceCheckIndexId } from "~/server/elasticsearch";

export const TRACE_CHECKS_QUEUE_NAME = "trace_checks";

const traceChecksQueue = new Queue<TraceCheckJob, any, string>(
  TRACE_CHECKS_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    },
  }
);

export const scheduleTraceCheck = async ({
  check,
  trace,
  delay,
}: {
  check: TraceCheckJob["check"];
  trace: TraceCheckJob["trace"];
  delay?: number;
}) => {
  await updateCheckStatusInES({
    check,
    trace: trace,
    status: "scheduled",
  });

  const jobId = traceCheckIndexId({
    traceId: trace.trace_id,
    checkId: check.id,
    projectId: trace.project_id,
  });
  const currentJob = await traceChecksQueue.getJob(jobId);
  if (currentJob) {
    const state = await currentJob.getState();
    if (state == "completed" || state == "failed") {
      await currentJob.retry(state);
    }
  } else {
    await traceChecksQueue.add(
      check.type,
      {
        // Recreating the check object to avoid passing the whole check object and making the queue heavy, we pass only the keys we need
        check: {
          id: check.id,
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
        delay: delay ?? 5000,
        attempts: 3,
      }
    );
  }
};

export const updateCheckStatusInES = async ({
  check,
  trace,
  status,
  score,
  passed,
  error,
  details,
  retries,
}: {
  check: TraceCheckJob["check"];
  trace: TraceCheckJob["trace"];
  status: TraceCheck["status"];
  error?: any;
  score?: number;
  passed?: boolean;
  details?: string;
  retries?: number;
}) => {
  const traceCheck: TraceCheck = {
    id: traceCheckIndexId({
      traceId: trace.trace_id,
      checkId: check.id,
      projectId: trace.project_id,
    }),
    trace_id: trace.trace_id,
    project_id: trace.project_id,
    thread_id: trace.thread_id,
    user_id: trace.user_id,
    customer_id: trace.customer_id,
    labels: trace.labels,
    check_id: check.id,
    check_type: check.type,
    status,
    ...(check.name && { check_name: check.name }),
    ...(score !== undefined && { score }),
    ...(passed !== undefined && { passed }),
    ...(error && { error: captureError(error) }),
    ...(details && { details }),
    ...(retries && { retries }),
    timestamps: {
      ...(status == "in_progress" && { started_at: Date.now() }),
      ...((status == "skipped" || status == "processed") && {
        finished_at: Date.now(),
      }),
      updated_at: Date.now(),
    },
  };

  await esClient.update({
    index: TRACE_CHECKS_INDEX,
    id: traceCheckIndexId({
      traceId: trace.trace_id,
      checkId: check.id,
      projectId: trace.project_id,
    }),
    body: {
      doc: traceCheck,
      upsert: {
        ...traceCheck,
        timestamps: {
          ...traceCheck.timestamps,
          inserted_at: Date.now(),
        },
      },
    },
    refresh: true,
  });
};

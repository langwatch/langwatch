import { Queue } from "bullmq";
import { connection } from "../server/redis";
import { captureError } from "../utils/captureError";
import { esClient, TRACE_CHECKS_INDEX } from "../server/elasticsearch";
import type { TraceCheck } from "../server/tracer/types";
import type { CheckTypes, TraceCheckJob } from "./types";

const traceChecksQueue = new Queue<TraceCheckJob, any, string>("trace_checks", {
  connection,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

export const scheduleTraceCheck = async ({
  check_type,
  trace_id,
  project_id,
  delay,
}: {
  check_type: CheckTypes;
  trace_id: string;
  project_id: string;
  delay?: number;
}) => {
  await updateCheckStatusInES({
    check_type,
    trace_id,
    project_id,
    status: "scheduled",
  });

  await traceChecksQueue.add(
    check_type,
    { trace_id, project_id },
    {
      jobId: `${trace_id}/${check_type}`,
      delay: delay ?? 5000,
      attempts: 3,
    }
  );
};

export const updateCheckStatusInES = async ({
  check_type,
  trace_id,
  project_id,
  status,
  raw_result,
  value,
  error,
  retries,
}: {
  check_type: string;
  trace_id: string;
  project_id: string;
  status: TraceCheck["status"];
  error?: any;
  raw_result?: object;
  value?: number;
  retries?: number;
}) => {
  const traceCheck: TraceCheck = {
    id: `check_${trace_id}/${check_type}`,
    trace_id,
    project_id,
    check_type,
    status,
    ...(raw_result && { raw_result }),
    ...(value && { value }),
    ...(error && { error: captureError(error) }),
    ...(retries && { retries }),
    timestamps: {
      ...(status == "in_progress" && { started_at: Date.now() }),
      ...((status == "succeeded" || status == "failed") && {
        finished_at: Date.now(),
      }),
    },
  };

  await esClient.update({
    index: TRACE_CHECKS_INDEX,
    id: traceCheck.id,
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

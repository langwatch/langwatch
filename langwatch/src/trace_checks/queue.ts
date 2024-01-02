import { Queue } from "bullmq";
import { connection } from "../server/redis";
import { captureError } from "../utils/captureError";
import { esClient, TRACE_CHECKS_INDEX } from "../server/elasticsearch";
import type { TraceCheck } from "../server/tracer/types";
import type { TopicClusteringJob, TraceCheckJob } from "./types";
import crypto from "crypto";
import { prisma } from "../server/db";

const traceChecksQueue = new Queue<TraceCheckJob, any, string>("trace_checks", {
  connection,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

const topicClusteringQueue = new Queue<TopicClusteringJob, void, string>(
  "topic_clustering",
  {
    connection,
    defaultJobOptions: {
      backoff: {
        type: "exponential",
        delay: 5000,
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
        id: trace.id,
        project_id: trace.project_id,
        thread_id: trace.thread_id,
        user_id: trace.user_id,
        customer_id: trace.customer_id,
        labels: trace.labels,
      },
    },
    {
      jobId: getTraceCheckId(trace.id, check.id),
      delay: delay ?? 5000,
      attempts: 3,
    }
  );
};

export const getTraceCheckId = (trace_id: string, check_id: string) =>
  `trace_check_${trace_id}/${check_id}`;

export const updateCheckStatusInES = async ({
  check,
  trace,
  status,
  raw_result,
  value,
  error,
  retries,
}: {
  check: TraceCheckJob["check"];
  trace: TraceCheckJob["trace"];
  status: TraceCheck["status"];
  error?: any;
  raw_result?: object;
  value?: number;
  retries?: number;
}) => {
  const traceCheck: TraceCheck = {
    id: getTraceCheckId(trace.id, check.id),
    trace_id: trace.id,
    project_id: trace.project_id,
    thread_id: trace.thread_id,
    user_id: trace.user_id,
    customer_id: trace.customer_id,
    labels: trace.labels,
    check_id: check.id,
    check_type: check.type,
    status,
    ...(check.name && { check_name: check.name }),
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

export const scheduleTopicClustering = async () => {
  const projects = await prisma.project.findMany({
    where: { firstMessage: true },
    select: { id: true },
  });

  const jobs = projects.map((project) => {
    const hash = crypto.createHash("sha256");
    hash.update(project.id);
    const hashedValue = hash.digest("hex");
    const hashNumber = parseInt(hashedValue, 16);
    const distributionHour = hashNumber % (24 * 60);
    const distributionMinute = hashNumber % 60;
    const yyyymmdd = new Date().toISOString().split("T")[0];

    return {
      name: "topic_clustering",
      data: { project_id: project.id },
      opts: {
        jobId: `topic_clustering_${project.id}_${yyyymmdd}`,
        delay: distributionHour * 60 * 60 + distributionMinute * 60,
        attempts: 3,
      },
    };
  });

  await topicClusteringQueue.addBulk(jobs);
};

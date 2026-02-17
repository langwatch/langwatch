import { type Job, Worker } from "bullmq";
import { createWorkerTelemetry } from "../bullmqTelemetry";
import type { TopicClusteringJob } from "~/server/background/types";
import { withJobContext } from "../../context/asyncContext";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  recordJobWaitDuration,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import { clusterTopicsForProject } from "../../topicClustering/topicClustering";
import { TOPIC_CLUSTERING_QUEUE } from "../queues/topicClusteringQueue";

const logger = createLogger("langwatch:workers:topicClusteringWorker");

export async function runTopicClusteringJob(
  job: Job<TopicClusteringJob, void, string>,
) {
  recordJobWaitDuration(job, "topic_clustering");
  getJobProcessingCounter("topic_clustering", "processing").inc();
  const start = Date.now();
  logger.info({ jobId: job.id, data: job.data }, "processing job");

  await clusterTopicsForProject(job.data.project_id, job.data.search_after);
  getJobProcessingCounter("topic_clustering", "completed").inc();
  const duration = Date.now() - start;
  getJobProcessingDurationHistogram("topic_clustering").observe(duration);
}

export const startTopicClusteringWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping collector worker");
    return;
  }

  const topicClusteringWorker = new Worker<TopicClusteringJob, void, string>(
    TOPIC_CLUSTERING_QUEUE.NAME,
    withJobContext(runTopicClusteringJob),
    {
      connection,
      concurrency: 3,
      telemetry: createWorkerTelemetry(TOPIC_CLUSTERING_QUEUE.NAME),
    },
  );

  topicClusteringWorker.on("ready", () => {
    logger.info("topic clustering worker active, waiting for jobs!");
  });

  topicClusteringWorker.on("failed", async (job, err) => {
    getJobProcessingCounter("topic_clustering", "failed").inc();
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    await withScope((scope) => {
      scope.setTag?.("worker", "topicClustering");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("topic clustering checks worker registered");
  return topicClusteringWorker;
};

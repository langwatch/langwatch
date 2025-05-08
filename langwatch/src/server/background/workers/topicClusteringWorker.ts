import * as Sentry from "@sentry/nextjs";
import { type Job, Worker } from "bullmq";
import type { TopicClusteringJob } from "~/server/background/types";
import { createLogger } from "../../../utils/logger";
import { connection } from "../../redis";
import { clusterTopicsForProject } from "../../topicClustering/topicClustering";
import { TOPIC_CLUSTERING_QUEUE_NAME } from "../queues/topicClusteringQueue";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";

const logger = createLogger("langwatch:workers:topicClusteringWorker");

export async function runTopicClusteringJob(
  job: Job<TopicClusteringJob, void, string>
) {
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
    TOPIC_CLUSTERING_QUEUE_NAME,
    runTopicClusteringJob,
    {
      connection,
      concurrency: 3,
    }
  );

  topicClusteringWorker.on("ready", () => {
    logger.info("topic clustering worker active, waiting for jobs!");
  });

  topicClusteringWorker.on("failed", (job, err) => {
    getJobProcessingCounter("topic_clustering", "failed").inc();
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    Sentry.withScope((scope) => {
      scope.setTag("worker", "topicClustering");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  logger.info("topic clustering checks worker registered");
  return topicClusteringWorker;
};

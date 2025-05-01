import * as Sentry from "@sentry/nextjs";
import { type Job, Worker } from "bullmq";
import type { TopicClusteringJob } from "~/server/background/types";
import { createLogger } from "../../../utils/logger.server";
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
  logger.info(`Processing job ${job.id} with data:`, job.data);

  await clusterTopicsForProject(job.data.project_id, job.data.search_after);
  getJobProcessingCounter("topic_clustering", "completed").inc();
  const duration = Date.now() - start;
  getJobProcessingDurationHistogram("topic_clustering").observe(duration);
}

export const startTopicClusteringWorker = () => {
  if (!connection) {
    logger.info("No redis connection, skipping collector worker");
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
    logger.info("Topic clustering worker active, waiting for jobs!");
  });

  topicClusteringWorker.on("failed", (job, err) => {
    getJobProcessingCounter("topic_clustering", "failed").inc();
    logger.error(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.withScope((scope) => {
      scope.setTag("worker", "topicClustering");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  logger.info("Topic clustering checks worker registered");
  return topicClusteringWorker;
};

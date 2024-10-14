import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { TopicClusteringJob } from "~/server/background/types";
import { getDebugger } from "../../../utils/logger";
import { connection } from "../../redis";
import { clusterTopicsForProject } from "../../topicClustering/topicClustering";
import { TOPIC_CLUSTERING_QUEUE_NAME } from "../queues/topicClusteringQueue";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";

const debug = getDebugger("langwatch:workers:topicClusteringWorker");

export const startTopicClusteringWorker = () => {
  if (!connection) {
    debug("No redis connection, skipping collector worker");
    return;
  }

  const topicClusteringWorker = new Worker<TopicClusteringJob, void, string>(
    TOPIC_CLUSTERING_QUEUE_NAME,
    async (job) => {
      getJobProcessingCounter("topic_clustering", "processing").inc();
      const start = Date.now();
      debug(`Processing job ${job.id} with data:`, job.data);

      await clusterTopicsForProject(job.data.project_id, job.data.search_after);
      getJobProcessingCounter("topic_clustering", "completed").inc();
      const duration = Date.now() - start;
      getJobProcessingDurationHistogram("topic_clustering").observe(duration);
    },
    {
      connection,
      concurrency: 3,
    }
  );

  topicClusteringWorker.on("ready", () => {
    debug("Topic clustering worker active, waiting for jobs!");
  });

  topicClusteringWorker.on("failed", (job, err) => {
    getJobProcessingCounter("topic_clustering", "failed").inc();
    debug(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.withScope((scope) => {
      scope.setTag("worker", "topicClustering");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  debug("Topic clustering checks worker registered");
  return topicClusteringWorker;
};

import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { TopicClusteringJob } from "../../../trace_checks/types";
import { getDebugger } from "../../../utils/logger";
import { connection } from "../../redis";
import { clusterTopicsForProject } from "../../topicClustering/topicClustering";

const debug = getDebugger("langwatch:workers:topicClusteringWorker");

export const startTopicClusteringWorker = () => {
  const topicClusteringWorker = new Worker<TopicClusteringJob, void, string>(
    "topic_clustering",
    async (job) => {
      debug(`Processing job ${job.id} with data:`, job.data);

      await clusterTopicsForProject(job.data.project_id, job.data.search_after);
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
    debug(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.captureException(err);
  });

  return topicClusteringWorker;
};

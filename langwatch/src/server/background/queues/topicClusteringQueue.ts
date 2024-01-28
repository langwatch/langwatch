import { Queue } from "bullmq";
import { connection } from "../../redis";
import type { TopicClusteringJob } from "~/server/background/types";
import crypto from "crypto";
import { prisma } from "../../db";

export const TOPIC_CLUSTERING_QUEUE_NAME = "topic_clustering";

const topicClusteringQueue = new Queue<TopicClusteringJob, void, string>(
  TOPIC_CLUSTERING_QUEUE_NAME,
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
    const distributionHour = hashNumber % 24;
    const distributionMinute = hashNumber % 60;
    const yyyymmdd = new Date().toISOString().split("T")[0];

    return {
      name: "topic_clustering",
      data: { project_id: project.id },
      opts: {
        jobId: `topic_clustering_${project.id}_${yyyymmdd}`,
        delay:
          distributionHour * 60 * 60 * 1000 + distributionMinute * 60 * 1000,
        attempts: 3,
      },
    };
  });

  await topicClusteringQueue.addBulk(jobs);
};

export const scheduleTopicClusteringNextPage = async (
  projectId: string,
  searchAfter: [number, string]
) => {
  const yyyymmdd = new Date().toISOString().split("T")[0];

  await topicClusteringQueue.add(
    "topic_clustering",
    { project_id: projectId, search_after: searchAfter },
    {
      jobId: `topic_clustering_${projectId}_${yyyymmdd}_${searchAfter.join(
        "_"
      )}`,
      delay: 1000,
      attempts: 3,
    }
  );
};

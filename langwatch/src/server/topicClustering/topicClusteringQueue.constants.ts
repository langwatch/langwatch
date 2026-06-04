import { makeQueueName } from "../queues/makeQueueName";

export type TopicClusteringJob = {
  project_id: string;
  search_after?: [number, string];
};

export const TOPIC_CLUSTERING_QUEUE = {
  NAME: makeQueueName("topic_clustering"),
  JOB: "topic_clustering",
} as const;

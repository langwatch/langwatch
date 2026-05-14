import { collectorQueue } from "./collectorQueue";
import { evaluationsQueue } from "./evaluationsQueue";
import { topicClusteringQueue } from "./topicClusteringQueue";
import { usageStatsQueue } from "./usageStatsQueue";
export const monitoredQueues = [
  { name: "collector", queue: collectorQueue },
  { name: "evaluations", queue: evaluationsQueue },
  { name: "topic_clustering", queue: topicClusteringQueue },
  { name: "usage_stats", queue: usageStatsQueue },
] as const;

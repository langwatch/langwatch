import { collectorQueue } from "./collectorQueue";
import { evaluationsQueue } from "./evaluationsQueue";
import { topicClusteringQueue } from "./topicClusteringQueue";
import { trackEventsQueue } from "./trackEventsQueue";
import { usageStatsQueue } from "./usageStatsQueue";
import { scenarioQueue } from "../../scenarios/scenario.queue";

export const monitoredQueues = [
  { name: "collector", queue: collectorQueue },
  { name: "evaluations", queue: evaluationsQueue },
  { name: "topic_clustering", queue: topicClusteringQueue },
  { name: "track_events", queue: trackEventsQueue },
  { name: "usage_stats", queue: usageStatsQueue },
  { name: "scenario", queue: scenarioQueue },
] as const;

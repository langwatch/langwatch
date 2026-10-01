/**
 * The clustering reads. They refresh on the topic-clustering read hints (`invalidatedBy` on the
 * contract), never on a timer (ARCHITECTURE.md §10).
 */

import { topicApi } from "./topic-api.ts";

export function useClusteringStatus({ projectId }: { projectId: string }) {
  return topicApi.topics.getClusteringStatus.useQuery({ projectId });
}

export function useClusteringRunHistory({ projectId }: { projectId: string }) {
  return topicApi.topics.getClusteringRunHistory.useQuery({ projectId });
}

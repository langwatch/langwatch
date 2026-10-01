/**
 * The clustering reads. While a run is underway they poll on a short cadence and stop once it
 * settles. L5 candidate: a topic-clustering event should drive this instead of a timer.
 */

import { nowInstant } from "@langwatch/time";

import { topicApi } from "./topic-api.ts";

/**
 * How long a just-requested run keeps the status card polling. Nothing is recorded at the
 * instant a run begins, so the card cannot see the run until the request itself reaches the
 * read model; without this window the card would settle on the pre-click answer and sit there.
 */
const REQUEST_SETTLE_WINDOW_MS = 30_000;

/** Poll cadence while a run is underway; the query stops itself once it settles. */
const RUNNING_POLL_MS = 5_000;

export function useClusteringStatus({
  projectId,
  lastTriggeredAt,
}: {
  projectId: string;
  lastTriggeredAt: number | null;
}) {
  return topicApi.topics.getClusteringStatus.useQuery(
    { projectId },
    {
      // needs a read hint: topic clustering run started or settled
      refetchInterval: (query) => {
        if (query.state.data?.isRunInFlight) return RUNNING_POLL_MS;
        if (
          lastTriggeredAt !== null &&
          nowInstant().epochMilliseconds - lastTriggeredAt < REQUEST_SETTLE_WINDOW_MS
        ) {
          return RUNNING_POLL_MS;
        }
        return false;
      },
    },
  );
}

export function useClusteringRunHistory({ projectId }: { projectId: string }) {
  return topicApi.topics.getClusteringRunHistory.useQuery(
    { projectId },
    {
      // needs a read hint: topic clustering run started or settled
      refetchInterval: (query) =>
        query.state.data?.some((run) => run.outcome === "running") ? RUNNING_POLL_MS : false,
    },
  );
}

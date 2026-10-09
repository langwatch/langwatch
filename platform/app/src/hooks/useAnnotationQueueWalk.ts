import { keepPreviousData } from "@tanstack/react-query";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * One step of the annotation queue walk: the item on screen, where it sits in
 * the queue, and the ids either side of it.
 *
 * The walk reads one item at a time on purpose. The page shows one
 * conversation, so resolving the whole queue to render it was work nobody
 * asked for — work that grew with the queue until it stopped working at all.
 * Stepping is a fresh read, which is what lets the item carry its whole trace:
 * the reviewer is never handed an item the page cannot show.
 */
export function useAnnotationQueueWalk({
  queueItemId,
}: {
  /** The item the URL names. Absent starts at the front of the queue. */
  queueItemId?: string;
} = {}) {
  const { project } = useOrganizationTeamProject();

  const step = api.annotation.getQueueWalkStep.useQuery(
    {
      projectId: project?.id ?? "",
      ...(queueItemId ? { queueItemId } : {}),
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
      // Stepping to the next item is a new read of the same shape, so the bar
      // and the conversation keep the item they are on until the next one has
      // arrived, rather than blanking between the two. What is kept is the item
      // the reviewer has *left*, so anything that acts on it must wait for the
      // new read: see `stepIsStale`.
      placeholderData: keepPreviousData,
    },
  );

  return {
    item: step.data?.item ?? null,
    /** The item's rank in the queue, from 1. Zero when there is no item. */
    position: step.data?.position ?? 0,
    total: step.data?.total ?? 0,
    previousItemId: step.data?.previousItemId ?? null,
    nextItemId: step.data?.nextItemId ?? null,
    // Nothing is finished before it is known: an unanswered read is a queue
    // still being read, not an empty one.
    queueFinished: step.data?.queueFinished ?? false,
    queueLoading: step.isLoading,
    /**
     * Whether the item above is the one the reviewer has left rather than the
     * one they asked for: the URL names a new item and its read is still in
     * flight.
     *
     * Anything that acts on the item — finishing it, opening its trace — has to
     * be held until this clears, or it acts on the item behind. A timer cannot
     * stand in for this: the read fetches a whole trace, so it routinely
     * outlasts any beat short enough to feel responsive.
     */
    stepIsStale: step.isPlaceholderData,
  };
}

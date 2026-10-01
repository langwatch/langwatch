/**
 * One step of the annotation queue walk: the item on screen, where it sits in
 * the queue, and the ids either side of it. One item per read, so the item
 * carries its whole trace and the page never resolves the whole queue.
 */

import { useAnnotationHost } from "../model/annotation-host.ts";
import { annotationApi } from "./annotation-api.ts";

export function useAnnotationQueueWalk({
  queueItemId,
}: {
  /** The item the URL names. Absent starts at the front of the queue. */
  queueItemId?: string | undefined;
} = {}) {
  const project = useAnnotationHost().project();

  const step = annotationApi.annotation.getQueueWalkStep.useQuery(
    { projectId: project?.id ?? "", ...(queueItemId ? { queueItemId } : {}) },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
      // The bar and the conversation keep the item they are on until the next
      // one arrives; anything acting on it waits for `stepIsStale` to clear.
      placeholderData: (previous) => previous,
    },
  );

  return {
    item: step.data?.item ?? null,
    /** The item's rank in the queue, from 1. Zero when there is no item. */
    position: step.data?.position ?? 0,
    total: step.data?.total ?? 0,
    previousItemId: step.data?.previousItemId ?? null,
    nextItemId: step.data?.nextItemId ?? null,
    // An unanswered read is a queue still being read, not an empty one.
    queueFinished: step.data?.queueFinished ?? false,
    queueLoading: step.isLoading,
    /** The item above is the one the reviewer has left; the one they asked for is in flight. */
    stepIsStale: step.isPlaceholderData,
  };
}

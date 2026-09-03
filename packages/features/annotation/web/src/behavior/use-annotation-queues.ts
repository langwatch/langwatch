/**
 * One page of the reviewer's queue work, however the list is scoped.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/hooks/useAnnotationQueues.tsx`,
 * which stays where it is: the annotation queue walker
 * (`/annotations/my-queue`) has not moved — it mounts four thousand lines of
 * `features/traces-v2`' conversation view, which belongs to the traces family —
 * and deletes-only forbids repointing it.
 *
 * NARROWED. The platform hook read the page and the page size off the router
 * itself; here they arrive as arguments, because the screen already reads them
 * through the host's route port and two independent readings of one address is
 * how a list and its pager come to disagree.
 */

import { useMemo } from "react";
import { annotationApi } from "./annotation-api";
import type { AnnotationQueueItemRead } from "./annotation-api";

/** The date range, only when there is one, so it spreads into the input. */
function dateRangeInput({ startDate, endDate }: { startDate?: Date; endDate?: Date }): {
  startDate?: Date;
  endDate?: Date;
} {
  const range: { startDate?: Date; endDate?: Date } = {};
  if (startDate) range.startDate = startDate;
  if (endDate) range.endDate = endDate;
  return range;
}

export type AnnotationQueuesReading = {
  assignedQueueItems: AnnotationQueueItemRead[];
  totalCount: number;
  queuesLoading: boolean;
};

export function useAnnotationQueues({
  projectId,
  selectedAnnotations = "pending",
  queueId,
  showQueueAndUser = false,
  allQueueItems = false,
  pageOffset,
  pageSize,
  startDate,
  endDate,
  enabled = true,
}: {
  projectId: string | undefined;
  /** Pending / Completed / All. */
  selectedAnnotations?: string;
  /** Narrows the read to one queue. */
  queueId?: string;
  /** Widens it from the reviewer's own items to every queue they are on. */
  showQueueAndUser?: boolean;
  /**
   * Takes the paging off. The QUEUE WALKER's reading: it steps through the
   * whole sitting rather than a page of it, so a page boundary would end the
   * walk early.
   */
  allQueueItems?: boolean;
  pageOffset: number;
  pageSize: number;
  /** Narrows the read to items queued inside this range. */
  startDate?: Date;
  endDate?: Date;
  /** Off where the caller already has its rows and only needs the shape. */
  enabled?: boolean;
}): AnnotationQueuesReading {
  const reading = annotationApi.annotation.getOptimizedAnnotationQueues.useQuery(
    {
      projectId: projectId ?? "",
      selectedAnnotations,
      pageSize,
      pageOffset,
      queueId: queueId ?? "",
      showQueueAndUser,
      allQueueItems,
      ...dateRangeInput({ startDate, endDate }),
    },
    { enabled: !!projectId && enabled, refetchOnWindowFocus: false },
  );

  return useMemo(
    () => ({
      assignedQueueItems: reading.data?.assignedQueueItems ?? [],
      totalCount: reading.data?.totalCount ?? 0,
      queuesLoading: enabled && reading.isLoading,
    }),
    [reading.data, reading.isLoading, enabled],
  );
}

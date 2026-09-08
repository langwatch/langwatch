/** Queue paging and filters come from the screen's single route reading. */

import { useMemo } from "react";
import type { AnnotationPeriodMoment } from "../model/annotation-period.ts";
import { annotationApi } from "./annotation-api.ts";
import type { RouterOutputs } from "./annotation-api.ts";

/** Either end of the range, when the caller narrowed the read to one. */
type AnnotationPeriodRange = {
  startDate?: AnnotationPeriodMoment;
  endDate?: AnnotationPeriodMoment;
};

/** The date range, only when there is one, so it spreads into the input. */
function dateRangeInput({ startDate, endDate }: AnnotationPeriodRange): {
  startDate?: AnnotationPeriodMoment;
  endDate?: AnnotationPeriodMoment;
} {
  const range: AnnotationPeriodRange = {};
  if (startDate) range.startDate = startDate;

  if (endDate) range.endDate = endDate;

  return range;
}

export type AnnotationQueuesReading = {
  assignedQueueItems: RouterOutputs["annotation"]["getOptimizedAnnotationQueues"]["assignedQueueItems"];
  totalCount: number;
  queuesLoading: boolean;
  queuesReady: boolean;
  queuesError: unknown | undefined;
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
  startDate?: AnnotationPeriodMoment;
  endDate?: AnnotationPeriodMoment;
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
      queuesReady: enabled && reading.isSuccess,
      queuesError: reading.error,
    }),
    [reading.data, reading.error, reading.isLoading, reading.isSuccess, enabled],
  );
}

import { useMemo } from "react";
import { useRouter } from "~/utils/compat/next-router";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/** The date range, only when there is one, so it spreads into the input. */
const dateRangeInput = ({
  startDate,
  endDate,
}: {
  startDate?: Date;
  endDate?: Date;
}): { startDate?: Date; endDate?: Date } => {
  const range: { startDate?: Date; endDate?: Date } = {};
  if (startDate) range.startDate = startDate;
  if (endDate) range.endDate = endDate;
  return range;
};

export function useAnnotationQueues(
  {
    selectedAnnotations,
    queueId,
    showQueueAndUser,
    allQueueItems,
    startDate,
    endDate,
    enabled = true,
  }: {
    selectedAnnotations?: string;
    queueId?: string;
    showQueueAndUser?: boolean;
    allQueueItems?: boolean;
    /** Narrows the read to items queued inside this range. */
    startDate?: Date;
    endDate?: Date;
    /** Off where the caller already has its rows and only needs the shape. */
    enabled?: boolean;
  } = {
    selectedAnnotations: "pending",
    showQueueAndUser: false,
    allQueueItems: false,
  },
) {
  const { project } = useOrganizationTeamProject();

  const router = useRouter();
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize = parseInt(router.query.pageSize as string) || 25;

  const optimizedData = api.annotation.getOptimizedAnnotationQueues.useQuery(
    {
      projectId: project?.id ?? "",
      selectedAnnotations: selectedAnnotations ?? "pending",
      pageSize,
      pageOffset,
      queueId: queueId ?? "",
      showQueueAndUser: showQueueAndUser ?? false,
      allQueueItems: allQueueItems ?? false,
      ...dateRangeInput({ startDate, endDate }),
    },
    {
      enabled: !!project && enabled,
      refetchOnWindowFocus: false,
    },
  );

  // Memoize derived data to prevent unnecessary recalculations
  const derivedData = useMemo(() => {
    if (!optimizedData.data) {
      return {
        assignedQueueItems: [],
        totalCount: 0,
      };
    }

    const { assignedQueueItems, totalCount } = optimizedData.data;

    return {
      assignedQueueItems,
      totalCount,
    };
  }, [optimizedData.data]);

  return {
    assignedQueueItems: derivedData.assignedQueueItems,
    totalCount: derivedData.totalCount,
    queuesLoading: enabled && optimizedData.isLoading,
  };
}

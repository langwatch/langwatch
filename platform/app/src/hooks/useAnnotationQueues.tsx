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

/**
 * The read the list asks for: every default applied here rather than in the
 * hook, so the hook stays about wiring the query to the page and this stays
 * the one place that says what an unset option means.
 */
const queueReadInput = ({
  projectId,
  pageSize,
  pageOffset,
  options,
}: {
  projectId: string;
  pageSize: number;
  pageOffset: number;
  options: UseAnnotationQueuesOptions;
}) => ({
  projectId,
  selectedAnnotations: options.selectedAnnotations ?? "pending",
  pageSize,
  pageOffset,
  queueId: options.queueId ?? "",
  // Absent rather than empty: an empty pick means "every queue", and an empty
  // list would narrow the read to nothing.
  ...(options.queueIds && options.queueIds.length > 0
    ? { queueIds: options.queueIds }
    : {}),
  showQueueAndUser: options.showQueueAndUser ?? false,
  allQueueItems: options.allQueueItems ?? false,
  ...dateRangeInput(options),
});

interface UseAnnotationQueuesOptions {
  selectedAnnotations?: string;
  queueId?: string;
  /** The reviewer's pick of queues to read. Empty or absent reads them all. */
  queueIds?: string[];
  showQueueAndUser?: boolean;
  allQueueItems?: boolean;
  /** Narrows the read to items queued inside this range. */
  startDate?: Date;
  endDate?: Date;
  /** Off where the caller already has its rows and only needs the shape. */
  enabled?: boolean;
}

export function useAnnotationQueues(
  options: UseAnnotationQueuesOptions = {
    selectedAnnotations: "pending",
    showQueueAndUser: false,
    allQueueItems: false,
  },
) {
  const { enabled = true } = options;
  const { project } = useOrganizationTeamProject();

  const router = useRouter();
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize = parseInt(router.query.pageSize as string) || 25;

  const optimizedData = api.annotation.getOptimizedAnnotationQueues.useQuery(
    queueReadInput({
      projectId: project?.id ?? "",
      pageSize,
      pageOffset,
      options,
    }),
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

import { useRouter } from "next/router";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { useRequiredSession } from "./useRequiredSession";
import { useMemo } from "react";

export function useAnnotationQueues(
  {
    selectedAnnotations,
    queueId,
    showQueueAndUser,
  }: {
    selectedAnnotations?: string;
    queueId?: string;
    showQueueAndUser?: boolean;
  } = {
    selectedAnnotations: "pending",
    showQueueAndUser: false,
  }
) {
  const { project } = useOrganizationTeamProject();

  const router = useRouter();
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize = parseInt(router.query.pageSize as string) || 25;

  // Use the new optimized endpoint that consolidates all data fetching
  const optimizedData = api.annotation.getOptimizedAnnotationQueues.useQuery(
    {
      projectId: project?.id ?? "",
      selectedAnnotations: selectedAnnotations ?? "pending",
      pageSize: pageSize ?? 25,
      pageOffset: pageOffset ?? 0,
      queueId: queueId ?? "",
      showQueueAndUser: showQueueAndUser ?? false,
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  // Get score options (this is still needed separately as it's used across the app)
  const scoreOptions = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  // Memoize derived data to prevent unnecessary recalculations
  const derivedData = useMemo(() => {
    if (!optimizedData.data) {
      return {
        assignedQueueItems: [],
        totalCount: 0,
      };
    }

    const { assignedQueueItems, totalCount, queues } = optimizedData.data;

    return {
      assignedQueueItems,
      totalCount,
    };
  }, [optimizedData.data]);

  return {
    // Direct data from optimized endpoint
    assignedQueueItems: derivedData.assignedQueueItems,
    totalCount: derivedData.totalCount,
    scoreOptions,
    queuesLoading: optimizedData.isLoading,
  };
}

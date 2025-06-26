import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { useRequiredSession } from "./useRequiredSession";
import { useMemo } from "react";

export function useAnnotationQueues() {
  const { project } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const user = session?.user;

  // Use the new optimized endpoint that consolidates all data fetching
  const optimizedData = api.annotation.getOptimizedAnnotationQueues.useQuery(
    {
      projectId: project?.id ?? "",
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
        memberAccessibleQueueItems: [],
        doneQueueItems: [],
        memberAccessibleQueues: [],
      };
    }

    const {
      assignedQueueItems,
      memberAccessibleQueueItems,
      doneQueueItems,
      memberAccessibleQueues,
    } = optimizedData.data;

    return {
      assignedQueueItems,
      memberAccessibleQueueItems,
      doneQueueItems,
      memberAccessibleQueues,
    };
  }, [optimizedData.data]);

  return {
    // Direct data from optimized endpoint
    assignedQueueItems: derivedData.assignedQueueItems,
    memberAccessibleQueueItems: derivedData.memberAccessibleQueueItems,
    doneQueueItems: derivedData.doneQueueItems,
    memberAccessibleQueues: derivedData.memberAccessibleQueues,

    // Legacy compatibility - these are now the same as the optimized versions
    assignedQueueItemsWithTraces: derivedData.assignedQueueItems,
    memberAccessibleQueueItemsWithTraces:
      derivedData.memberAccessibleQueueItems,
    doneQueueItemsWithTraces: derivedData.doneQueueItems,

    scoreOptions,
    queuesLoading: optimizedData.isLoading,
  };
}

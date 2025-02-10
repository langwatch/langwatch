import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { useRequiredSession } from "./useRequiredSession";

export function useAnnotationQueues() {
  const { project } = useOrganizationTeamProject();

  const { data: session } = useRequiredSession();

  const user = session?.user;

  const queues = api.annotation.getQueues.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    }
  );

  const queueItems = api.annotation.getQueueItems.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const doneQueueItems = api.annotation.getDoneQueueItems.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const doneQueueItemsFiltered = doneQueueItems.data?.filter(
    (item) =>
      item.userId === user?.id ||
      item.annotationQueue?.members.some((member) => member.userId === user?.id)
  );

  const assignedQueueItems = queueItems.data?.filter(
    (item) => item.userId === user?.id
  );
  const traceIdsForAssignedQueueItems = assignedQueueItems?.flatMap(
    (item) => item.traceId
  );
  const doneTraceIdsForAssignedQueueItems = doneQueueItemsFiltered?.flatMap(
    (item) => item.traceId
  );

  const memberAccessibleQueues = queues.data?.filter((queue) =>
    queue.members.some((member) => member.userId === user?.id)
  );
  const memberAccessibleQueueItems = memberAccessibleQueues?.flatMap(
    (queue) => queue.AnnotationQueueItems
  );
  const traceIdsForMemberAccessibleQueueItems =
    memberAccessibleQueueItems?.flatMap((item) => item.traceId);

  const traceIds = [
    ...(traceIdsForAssignedQueueItems ?? []),
    ...(traceIdsForMemberAccessibleQueueItems ?? []),
    ...(doneTraceIdsForAssignedQueueItems ?? []),
  ];

  const traces = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds,
    },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    }
  );

  const annotations = api.annotation.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    }
  );

  const assignedQueueItemsWithTraces = assignedQueueItems?.map((item) => ({
    ...item,
    trace: traces.data?.find((trace) => trace.trace_id === item.traceId),
    annotations: annotations.data?.filter(
      (annotation) => annotation.traceId === item.traceId
    ),
    scoreOptions: annotations.data
      ?.filter((annotation) => annotation.traceId === item.traceId)
      ?.flatMap((annotation) =>
        annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : []
      ),
  }));

  const memberAccessibleQueueItemsWithTraces = memberAccessibleQueueItems?.map(
    (item) => {
      const relevantAnnotations = annotations.data?.filter(
        (annotation) => annotation.traceId === item.traceId
      );

      return {
        ...item,
        trace: traces.data?.find((trace) => trace.trace_id === item.traceId),
        annotations: relevantAnnotations,
        queueName: memberAccessibleQueues?.find(
          (queue) => queue.id === item.annotationQueueId
        )?.name,
        scoreOptions: relevantAnnotations?.flatMap((annotation) =>
          annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : []
        ),
      };
    }
  );

  const doneQueueItemsWithTraces = doneQueueItemsFiltered?.map((item) => ({
    ...item,
    trace: traces.data?.find((trace) => trace.trace_id === item.traceId),
    annotations: annotations.data?.filter(
      (annotation) => annotation.traceId === item.traceId
    ),
    scoreOptions: annotations.data
      ?.filter((annotation) => annotation.traceId === item.traceId)
      ?.flatMap((annotation) =>
        annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : []
      ),
  }));

  const scoreOptions = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  return {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    doneQueueItemsWithTraces,
    memberAccessibleQueues,
    scoreOptions,
    queuesLoading: queues.isLoading || queueItems.isLoading || traces.isLoading,
  };
}

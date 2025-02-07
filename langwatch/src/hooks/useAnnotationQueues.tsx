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
    }
  );

  console.log("queueItems", queueItems.data);

  const assignedQueueItems = queueItems.data?.filter(
    (item) => item.userId === user?.id
  );
  const traceIdsForAssignedQueueItems = assignedQueueItems?.flatMap(
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
  ];

  const traces = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds,
    },
    {
      enabled: !!project?.id,
    }
  );

  const annotations = api.annotation.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
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
    (item) => ({
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
    })
  );

  console.log("assignedQueueItemsWithTraces", assignedQueueItemsWithTraces);

  return {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    memberAccessibleQueues,
    queuesLoading: queues.isLoading || queueItems.isLoading || traces.isLoading,
  };
}

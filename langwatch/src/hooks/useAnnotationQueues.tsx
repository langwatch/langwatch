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

  const doneQueueItems = queueItems.data?.filter(
    (item) => item.doneAt !== null
  );

  const doneQueueItemsFiltered = doneQueueItems?.filter(
    (item) =>
      item.userId === user?.id ||
      item.annotationQueue?.members.some((member) => member.userId === user?.id)
  );

  const assignedQueueItems = queueItems.data?.filter(
    (item) => item.userId === user?.id
  );

  const memberAccessibleQueues = queues.data?.filter((queue) =>
    queue.members.some((member) => member.userId === user?.id)
  );
  const memberAccessibleQueueItems = memberAccessibleQueues?.flatMap(
    (queue) => queue.AnnotationQueueItems
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

      const queue = memberAccessibleQueues?.find(
        (queue) => queue.id === item.annotationQueueId
      );

      return {
        ...item,
        annotations: relevantAnnotations,
        members: queue?.members.map((member) => ({
          ...member,
          user: member.user,
        })),
        queueName: queue?.name,
        scoreOptions: relevantAnnotations?.flatMap((annotation) =>
          annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : []
        ),
      };
    }
  );

  const doneQueueItemsWithTraces = doneQueueItemsFiltered?.map((item) => ({
    ...item,
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
    assignedQueueItems,
    memberAccessibleQueueItems,
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    doneQueueItemsWithTraces,
    memberAccessibleQueues,
    scoreOptions,
    queuesLoading: queues.isLoading || queueItems.isLoading,
  };
}

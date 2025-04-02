import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { useRequiredSession } from "./useRequiredSession";

const batchArray = (array: string[], batchSize: number) => {
  const batches: string[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
};

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

  const MAX_BATCH_SIZE = 20;
  const traceBatches = batchArray(traceIds, MAX_BATCH_SIZE);

  const MAX_QUERIES = 10;

  const batchQueries = [];
  for (let i = 0; i < MAX_QUERIES; i++) {
    const batch = traceBatches[i] || [];
    const query = api.traces.getTracesWithSpans.useQuery(
      {
        projectId: project?.id ?? "",
        traceIds: batch,
      },
      {
        enabled: !!project?.id && batch.length > 0,
        refetchOnWindowFocus: false,
      }
    );
    batchQueries.push(query);
  }

  const traces = batchQueries
    .filter((query) => query.data)
    .flatMap((query) => query.data || []);

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
    trace: traces?.find((trace) => trace.trace_id === item.traceId),
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
        trace: traces?.find((trace) => trace.trace_id === item.traceId),
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
    trace: traces?.find((trace) => trace.trace_id === item.traceId),
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
    queuesLoading:
      queues.isLoading ||
      queueItems.isLoading ||
      doneQueueItems.isLoading ||
      batchQueries.some((query) => query.isLoading),
  };
}

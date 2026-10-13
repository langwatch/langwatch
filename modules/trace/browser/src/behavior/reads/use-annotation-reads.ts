import { api } from "../trace-api.ts";

export function useAnnotationQueues({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  return api.annotation.getQueues.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
}

export function useAnnotationQueue({
  projectId,
  queueId,
  enabled = true,
}: {
  projectId: string | undefined;
  queueId: string | undefined;
  enabled?: boolean;
}) {
  return api.annotation.getQueueBySlugOrId.useQuery(
    { queueId: queueId ?? "", projectId: projectId ?? "" },
    { enabled: !!projectId && !!queueId && enabled },
  );
}

export function useActiveAnnotationScores({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  return api.annotationScore.getAllActive.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
}

export function useTraceAnnotations({
  projectId,
  traceId,
  anchor,
  enabled = true,
}: {
  projectId: string | undefined;
  traceId: string;
  anchor?: "trace";
  enabled?: boolean;
}) {
  return api.annotation.getByTraceId.useQuery(
    { projectId: projectId ?? "", traceId, ...(anchor ? { anchor } : {}) },
    { enabled: !!projectId && enabled },
  );
}

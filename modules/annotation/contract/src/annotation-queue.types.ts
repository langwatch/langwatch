export type AnnotationQueueConfiguration = Readonly<{
  projectId: string;
  queueId?: string;
  name: string;
  description: string;
  userIds: readonly string[];
  scoreTypeIds: readonly string[];
}>;
export type AnnotationQueueScope = Readonly<{ projectId: string }>;
export type AnnotationQueueCaller = Readonly<{ projectId: string; userId: string }>;
export type QueueAnnotationTracesInput = AnnotationQueueCaller &
  Readonly<{
    traceIds: readonly string[];
    annotators: readonly string[];
  }>;

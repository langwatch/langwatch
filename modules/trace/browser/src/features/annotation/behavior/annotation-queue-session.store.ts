import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  type AnnotationQueueSessionState,
  createAnnotationQueueSession,
  TRACE_ANNOTATION_QUEUE_SESSION_SLICE,
} from "@langwatch/trace-contract";

export { isSessionMarked, sessionTraceIds, type SessionMark } from "@langwatch/trace-contract";

/**
 * The traces one sitting at the queue has collected, in the global UI store
 * (`trace:annotation-queue-session`); annotation reads it.
 */
export const useAnnotationQueueSessionStore = defineSlice<AnnotationQueueSessionState>({
  name: TRACE_ANNOTATION_QUEUE_SESSION_SLICE,
  create: createAnnotationQueueSession,
});

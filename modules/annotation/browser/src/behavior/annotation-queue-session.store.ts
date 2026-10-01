import { readSlice } from "@langwatch/browser-host/global-store";
import {
  ANNOTATION_QUEUE_SESSION_ABSENT,
  type AnnotationQueueSessionState,
  TRACE_ANNOTATION_QUEUE_SESSION_SLICE,
} from "@langwatch/trace-contract";

export { sessionTraceIds } from "@langwatch/trace-contract";

/** The traces one sitting at the queue has collected, read from `trace:annotation-queue-session`. */
export const useAnnotationQueueSessionStore = readSlice<AnnotationQueueSessionState>({
  name: TRACE_ANNOTATION_QUEUE_SESSION_SLICE,
  absent: ANNOTATION_QUEUE_SESSION_ABSENT,
});

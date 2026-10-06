/** Trace UI lent by token to the modules that walk or correct a trace (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** What annotation's queue walker hands the conversation trace lends it. */
export type AnnotationQueueConversationProps = {
  /** The trace the queue item names; its turn is the one under review. */
  traceId: string;
  /** The thread that trace belongs to, or null for a trace in no thread. */
  conversationId: string | null;
};

/** What a screen hands trace's way into correcting one trace. */
export type TraceEditButtonProps = {
  traceId: string;
  /** When the trace started, so the drawer reads its partition; null when unknown. */
  occurredAtMs: number | null;
  disabled?: boolean;
};

export const AnnotationQueueConversationToken = uiTokens(
  "trace",
).component<AnnotationQueueConversationProps>("annotationQueueConversation");
export const TraceEditButtonToken =
  uiTokens("trace").component<TraceEditButtonProps>("traceEditButton");

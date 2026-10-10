/** What trace lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { AnnotationQueueConversationToken, TraceEditButtonToken } from "@langwatch/trace-client";
import type {
  AnnotationQueueConversationProps,
  TraceEditButtonProps,
} from "@langwatch/trace-contract";

/** Trace's conversation for one queue item, rendered as trace lends it. */
export function AnnotationQueueConversation(props: AnnotationQueueConversationProps) {
  return <Lent of={AnnotationQueueConversationToken} props={props} />;
}

/** Trace's way into correcting one trace, rendered as trace lends it. */
export function TraceEditButton(props: TraceEditButtonProps) {
  return <Lent of={TraceEditButtonToken} props={props} />;
}

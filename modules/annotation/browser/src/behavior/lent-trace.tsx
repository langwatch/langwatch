/** What trace lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  AnnotationQueueConversationToken,
  TraceEditButtonToken,
  type AnnotationQueueConversationProps,
  type TraceEditButtonProps,
} from "@langwatch/trace-contract";

/** Trace's conversation for one queue item, rendered as trace lends it. */
export function AnnotationQueueConversation(props: AnnotationQueueConversationProps) {
  return <Lent of={AnnotationQueueConversationToken} props={props} />;
}

/** Trace's way into correcting one trace, rendered as trace lends it. */
export function TraceEditButton(props: TraceEditButtonProps) {
  return <Lent of={TraceEditButtonToken} props={props} />;
}

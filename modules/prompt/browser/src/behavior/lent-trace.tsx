/** What trace lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { ConversationThreadToken, type ConversationThreadProps } from "@langwatch/trace-client";

/** Trace's conversation renderer, rendered as trace lends it. */
export function ConversationThread(props: ConversationThreadProps) {
  return <Lent of={ConversationThreadToken} props={props} />;
}

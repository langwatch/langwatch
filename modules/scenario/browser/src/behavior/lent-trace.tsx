/** What trace lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  ConversationThreadToken,
  type ConversationThreadProps,
  SetupWithAgentButtonToken,
  TracePreviewHoverCardToken,
  type TracePreviewHoverCardProps,
} from "@langwatch/trace-client";
import type { SetupWithAgentButtonProps } from "@langwatch/trace-contract";

/** Trace's "Setup via Agent" menu, rendered as trace lends it. */
export function SetupWithAgentButton(props: SetupWithAgentButtonProps) {
  return <Lent of={SetupWithAgentButtonToken} props={props} />;
}

/** Trace's hover peek around a trigger; unlent or loading, the trigger stands on its own. */
export function TracePreviewHoverCard(props: TracePreviewHoverCardProps) {
  return <Lent of={TracePreviewHoverCardToken} props={props} fallback={props.children} />;
}

/** Trace's conversation renderer, rendered as trace lends it. */
export function ConversationThread(props: ConversationThreadProps) {
  return <Lent of={ConversationThreadToken} props={props} />;
}

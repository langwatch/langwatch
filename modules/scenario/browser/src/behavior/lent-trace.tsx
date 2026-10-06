/** What trace lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import {
  type UiConversationThreadProps,
  type UiTracePreviewHoverCardProps,
} from "@langwatch/browser-host/declarations";
import { Lent } from "@langwatch/browser-host/lent";
import {
  SetupWithAgentButtonToken,
  type SetupWithAgentButtonProps,
} from "@langwatch/trace-contract";
import { lazy, Suspense, useMemo } from "react";

/** Trace's "Setup via Agent" menu, rendered as trace lends it. */
export function SetupWithAgentButton(props: SetupWithAgentButtonProps) {
  return <Lent of={SetupWithAgentButtonToken} props={props} />;
}

/** Trace's hover peek around a trigger, rendered as trace lends it. */
export function TracePreviewHoverCard(props: UiTracePreviewHoverCardProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("tracePreviewHoverCard")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  // Unlent, or still loading, the trigger stands on its own without the peek.
  if (lent.length === 0) return props.children;
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={props.children}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Trace's conversation renderer, rendered as trace lends it. */
export function ConversationThread(props: UiConversationThreadProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("conversationThread")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

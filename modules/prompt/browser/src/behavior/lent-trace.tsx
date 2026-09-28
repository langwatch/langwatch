/** What trace lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiConversationThreadProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

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

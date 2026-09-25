/** What trace lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiAnnotationQueueConversationProps,
  UiTraceEditButtonProps,
} from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Trace's conversation for one queue item, rendered as trace lends it. */
export function AnnotationQueueConversation(props: UiAnnotationQueueConversationProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("annotationQueueConversation")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Trace's way into correcting one trace, rendered as trace lends it. */
export function TraceEditButton(props: UiTraceEditButtonProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("traceEditButton")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

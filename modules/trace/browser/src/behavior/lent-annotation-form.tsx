/** What annotation lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiAnnotateBodyProps,
  UiAnnotationFormFooterProps,
  UiAnnotationScoreEditorProps,
  UiSuggestBodyProps,
} from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Annotation's comment-and-scores body, rendered as annotation lends it. */
export function AnnotateBody(props: UiAnnotateBodyProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("annotateBody")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Annotation's suggested-output body, rendered as annotation lends it. */
export function SuggestBody(props: UiSuggestBodyProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("suggestBody")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Annotation's form footer, rendered as annotation lends it. */
export function FormFooter(props: UiAnnotationFormFooterProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("annotationFormFooter")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Annotation's score editor, rendered as annotation lends it. */
export function AnnotationScoreEditor(props: UiAnnotationScoreEditorProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("annotationScoreEditor")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

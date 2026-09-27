/** What workflow lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiHoverableBigTextProps,
  UiRedactedFieldProps,
} from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Workflow's clamped text that expands into a dialog; the plain text until it loads. */
export function HoverableBigText(props: UiHoverableBigTextProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("hoverableBigText")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  if (lent.length === 0) return <>{props.children}</>;
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={props.children}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Workflow's redaction marker around one trace field; the field itself until it loads. */
export function RedactedField(props: UiRedactedFieldProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("redactedField")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  if (lent.length === 0) return <>{props.children}</>;
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={props.loadingComponent ?? null}>
      <Lent {...props} />
    </Suspense>
  ));
}

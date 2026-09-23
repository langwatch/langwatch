/** What model-provider lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import { type UiModelSelectorProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Model-provider's model picker, rendered as model-provider lends it. */
export function ModelSelector(props: UiModelSelectorProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("modelSelector")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

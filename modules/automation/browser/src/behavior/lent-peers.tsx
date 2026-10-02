/** What trace lends this module (§3.4 rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiEvaluatorTracesMappingProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Trace's mapping editor over the project's recent sample traces. */
export function TracesMapping(props: UiEvaluatorTracesMappingProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("evaluatorTracesMapping")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

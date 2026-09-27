/** What scenario lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { MediaPartProps } from "@langwatch/scenario-contract";
import { lazy, Suspense, useMemo } from "react";

/** Scenario's media renderer, rendered as scenario lends it. */
export function LentMediaPart(props: MediaPartProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("mediaPart")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

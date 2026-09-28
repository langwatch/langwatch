/** Analytics' saved-dashboards list, drawn where navigation places it (§3.4 rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiSavedDashboardsProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

export function SavedDashboards(props: UiSavedDashboardsProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("savedDashboards")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

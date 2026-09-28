/** Dataset's picker list, as dataset lends it (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiDatasetPickerListProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Dataset's list of the project's datasets, handing the pick back to this module. */
export function DatasetPickerList(props: UiDatasetPickerListProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("datasetPickerList")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

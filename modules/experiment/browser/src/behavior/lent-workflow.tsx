/** Workflow's version badge and "Run via API" dialog, as workflow lends them (§3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiRunExperimentViaApiDialogProps,
  UiVersionBoxProps,
} from "@langwatch/browser-host/declarations";
import { Box } from "@langwatch/design-system/primitives";
import { lazy, Suspense, useMemo } from "react";

/** The lent badge; an empty box of the same width until it loads. */
export function VersionBox(props: UiVersionBoxProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("versionBox")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  const fallback = <Box minWidth={props.minWidth} height="44px" />;
  if (lent.length === 0) return fallback;
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={fallback}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** The lent dialog; nothing when workflow is not installed. */
export function RunExperimentViaApiDialog(props: UiRunExperimentViaApiDialogProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("runExperimentViaApiDialog")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

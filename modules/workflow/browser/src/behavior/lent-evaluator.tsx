/** What evaluator lends the studio through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiStudioEvaluatorEditorProps } from "@langwatch/browser-host/declarations";
import { Lent } from "@langwatch/browser-host/lent";
import {
  EvaluatorSettingsFormToken,
  type EvaluatorSettingsFormProps,
} from "@langwatch/evaluator-contract";
import { lazy, Suspense, useMemo } from "react";

/** Evaluator's editor for one saved evaluator node. */
export function StudioEvaluatorEditor(props: UiStudioEvaluatorEditorProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("studioEvaluatorEditor")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Evaluator's settings form for an inline evaluator node. */
export function EvaluatorSettingsForm(props: EvaluatorSettingsFormProps) {
  return <Lent of={EvaluatorSettingsFormToken} props={props} />;
}

/** What analytics, trace, experiment and prompt lend this module (§3.4 rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiComparisonConfigFormProps,
  UiEvaluatorTracesMappingProps,
  UiFilterSidebarProps,
  UiLlmConfigPopoverProps,
} from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo } from "react";

/** Analytics' filter sidebar for the sample traces. */
export function FilterSidebar(props: UiFilterSidebarProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("filterSidebar")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Trace's mapping editor over the project's recent sample traces. */
export function EvaluatorTracesMapping(props: UiEvaluatorTracesMappingProps) {
  const declarations = useUiDeclarations();
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

/** Experiment's form for a comparison evaluator's variants. */
export function ComparisonConfigForm(props: UiComparisonConfigFormProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("comparisonConfigForm")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Prompt's LLM parameter popover content. */
export function LLMConfigPopover(props: UiLlmConfigPopoverProps) {
  const declarations = useUiDeclarations();
  const lent = useMemo(
    () =>
      declarations
        .declared("llmConfigPopover")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** What analytics, trace, experiment and prompt lend this module (§3.4 rule 7). */

import { FilterSidebarToken, type FilterSidebarProps } from "@langwatch/analytics-contract";
import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiEvaluatorTracesMappingProps,
  UiLlmConfigPopoverProps,
} from "@langwatch/browser-host/declarations";
import { Lent } from "@langwatch/browser-host/lent";
import {
  ComparisonConfigFormToken,
  type ComparisonConfigFormProps,
} from "@langwatch/experiment-contract";
import { lazy, Suspense, useMemo } from "react";

/** Analytics' filter sidebar for the sample traces. */
export function FilterSidebar(props: FilterSidebarProps) {
  return <Lent of={FilterSidebarToken} props={props} />;
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
export function ComparisonConfigForm(props: ComparisonConfigFormProps) {
  return <Lent of={ComparisonConfigFormToken} props={props} />;
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

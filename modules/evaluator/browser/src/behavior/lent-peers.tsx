/** What analytics, trace, experiment and prompt lend this module (§3.4 rule 7). */

import { FilterSidebarToken, type FilterSidebarProps } from "@langwatch/analytics-client";
import { Lent } from "@langwatch/browser-host/lent";
import {
  ComparisonConfigFormToken,
  type ComparisonConfigFormProps,
} from "@langwatch/experiment-client";
import { LlmConfigPopoverToken, type LlmConfigPopoverProps } from "@langwatch/prompt-client";
import {
  EvaluatorTracesMappingToken,
  type EvaluatorTracesMappingProps,
} from "@langwatch/trace-client";

/** Analytics' filter sidebar for the sample traces. */
export function FilterSidebar(props: FilterSidebarProps) {
  return <Lent of={FilterSidebarToken} props={props} />;
}

/** Trace's mapping editor over the project's recent sample traces. */
export function EvaluatorTracesMapping(props: EvaluatorTracesMappingProps) {
  return <Lent of={EvaluatorTracesMappingToken} props={props} />;
}

/** Experiment's form for a comparison evaluator's variants. */
export function ComparisonConfigForm(props: ComparisonConfigFormProps) {
  return <Lent of={ComparisonConfigFormToken} props={props} />;
}

/** Prompt's LLM parameter popover content. */
export function LLMConfigPopover(props: LlmConfigPopoverProps) {
  return <Lent of={LlmConfigPopoverToken} props={props} />;
}

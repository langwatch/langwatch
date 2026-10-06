import { uiTokens } from "@langwatch/module";

import type { ComparisonEvaluatorConfig, TargetConfig } from "./experiment-workbench.ts";
/** Resolve legacy slot labels without changing current variant identifiers. */
export const resolveExperimentVerdictLabel = ({
  label,
  variants,
}: {
  label: string;
  variants: string[];
}): string => {
  if (variants.includes(label)) return label;
  if (label === "A") return variants[0] ?? label;
  if (label === "B") return variants[1] ?? label;
  return label;
};

/** The comparison evaluator form experiment lends the evaluator editor (§10, §10.1). */

/** What an evaluator editor hands experiment's comparison evaluator form. */
export type ComparisonConfigFormProps = {
  value: ComparisonEvaluatorConfig;
  onChange: (next: ComparisonEvaluatorConfig) => void;
  targets: TargetConfig[];
  datasetColumns: { id: string; name: string }[];
  datasetName?: string;
};

export const ComparisonConfigFormToken =
  uiTokens("experiment").component<ComparisonConfigFormProps>("comparisonConfigForm");

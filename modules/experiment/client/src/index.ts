/** Experiment UI lent by token to the evaluator editor (§10.1). */

import type { ComparisonEvaluatorConfig, TargetConfig } from "@langwatch/experiment-contract";
import { uiTokens } from "@langwatch/module";

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

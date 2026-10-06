/** The comparison evaluator form experiment lends the evaluator editor (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

import type { ComparisonEvaluatorConfig, TargetConfig } from "./experiment-workbench.ts";

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

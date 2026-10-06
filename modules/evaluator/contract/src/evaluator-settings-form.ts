/** The settings form evaluator lends the studio's inline evaluator node (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** What the studio hands evaluator's settings form for an inline evaluator node. */
export type EvaluatorSettingsFormProps = {
  evaluatorType: string;
  initialSettings: Record<string, unknown>;
  /** Fill in the evaluator's default settings on first render. */
  applyDefaults: boolean;
  onChange: (settings: Record<string, unknown>) => void;
};

export const EvaluatorSettingsFormToken =
  uiTokens("evaluator").component<EvaluatorSettingsFormProps>("evaluatorSettingsForm");

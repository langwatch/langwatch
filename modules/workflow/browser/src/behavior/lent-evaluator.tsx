/** What evaluator lends the studio by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  EvaluatorSettingsFormToken,
  StudioEvaluatorEditorToken,
  type EvaluatorSettingsFormProps,
  type StudioEvaluatorEditorProps,
} from "@langwatch/evaluator-client";

/** Evaluator's editor for one saved evaluator node. */
export function StudioEvaluatorEditor(props: StudioEvaluatorEditorProps) {
  return <Lent of={StudioEvaluatorEditorToken} props={props} />;
}

/** Evaluator's settings form for an inline evaluator node. */
export function EvaluatorSettingsForm(props: EvaluatorSettingsFormProps) {
  return <Lent of={EvaluatorSettingsFormToken} props={props} />;
}

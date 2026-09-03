/**
 * The evaluator presentation primitives `platform/app` still reads.
 *
 * This is the package's ROOT entry, and it survives the move of the evaluators
 * page for one reason: thirteen `platform/app` modules import it — the trace
 * span detail, the evaluator drawers, the online-evaluation table's neighbours
 * and the checks Try-it-out — and the deletes-only ruling forbids repointing a
 * single one of them. It costs one recorded `ui-web-public-entry` finding and
 * closes when those consumers move.
 *
 * The evaluators SCREEN is not here. It is published as `./screens/evaluators`,
 * which is the only entry a governed frontend feature may name.
 */

export {
  codeEvaluatorDisabledReason,
  type CodeEvaluatorCompletion,
} from "./model/code-evaluator-disabled-reason";
export {
  CodeEvaluatorEditor,
  type CodeEvaluatorEditorProps,
  type CodeEvaluatorField,
  validCodeEvaluatorFields,
} from "./ui/blocks/code-evaluator-editor";
export {
  EvaluatorCategoryPicker,
  evaluatorCategoryNames,
  type EvaluatorCategoryId,
  type EvaluatorCategoryPickerProps,
} from "./ui/blocks/evaluator-category-picker";
export {
  EvaluatorTypePicker,
  type EvaluatorAvailability,
  type EvaluatorTypePickerProps,
} from "./ui/blocks/evaluator-type-picker";
export { EvaluatorCard, type EvaluatorCardProps } from "./ui/blocks/evaluator-card";
export { EvaluatorListItem, type EvaluatorListItemProps } from "./ui/blocks/evaluator-list-item";
export {
  EvaluatorListEmptyState,
  type EvaluatorListEmptyStateProps,
} from "./ui/elements/evaluator-list-empty-state";
export {
  EvaluatorEditorActions,
  type EvaluatorEditorActionsProps,
  EvaluatorEditorHeading,
  type EvaluatorEditorHeadingProps,
} from "./ui/elements/evaluator-editor-chrome";
export { CheckStatusIcon } from "./ui/elements/evaluation-status";
export { evaluationPassed, evaluationStatusColor } from "./model/evaluation-status";
export {
  type EvaluationsTagSummary,
  evaluationsTagLabel,
  guardrailsTagLabel,
  summarizeEvaluationsTag,
} from "./model/evaluation-summary-counts";

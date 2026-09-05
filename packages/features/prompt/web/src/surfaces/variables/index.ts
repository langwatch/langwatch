/**
 * Variables UI.
 *
 * The interface for defining prompt variables and mapping them onto the
 * sources a run can read: dataset columns, workflow node fields, or a literal
 * value. Shared by the prompt playground, the optimization studio, evaluations
 * and the agent editors.
 *
 * @see specs/variables-ui/variables-section.feature
 * @see specs/variables-ui/variable-insertion-menu.feature
 * @see specs/variables-ui/prompt-textarea.feature
 */

export { FormVariablesSection } from "./form-variables-section";
export { type SelectedField, VariableInsertMenu } from "./variable-insert-menu";
export {
  type AvailableSource,
  type FieldMapping,
  type FieldType,
  type SourceType,
  VariableMappingInput,
} from "./variable-mapping-input";
export { type Variable, VariablesSection, type VariablesSectionProps } from "./variables-section";
export { PromptTextAreaWithVariables } from "./prompt-textarea";
export type {
  PromptTextAreaOnAddMention,
  PromptTextAreaWithVariablesProps,
} from "./prompt-textarea";
export {
  FieldTypeSelect,
  type FieldTypeOption,
  getTypeLabel,
  TYPE_LABELS,
  VariableTypeBadge,
  VariableTypeIcon,
} from "./variable-type";

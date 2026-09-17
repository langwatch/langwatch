/**
 * Variables UI: defines prompt variables and maps them onto dataset columns,
 * workflow node fields, or a literal value, shared across playground, studio,
 * evaluations and the agent editors.
 * @see specs/variables-ui/variables-section.feature
 */

export { FormVariablesSection } from "./form-variables-section.tsx";
export { type SelectedField, VariableInsertMenu } from "./variable-insert-menu.tsx";
export {
  type AvailableSource,
  type FieldMapping,
  type FieldType,
  type SourceType,
  VariableMappingInput,
} from "./variable-mapping-input.tsx";
export { type Variable, VariablesSection, type VariablesSectionProps } from "./variables-section.tsx";
export { PromptTextAreaWithVariables } from "./prompt-textarea/index.ts";
export type {
  PromptTextAreaOnAddMention,
  PromptTextAreaWithVariablesProps,
} from "./prompt-textarea/index.ts";
export {
  FieldTypeSelect,
  type FieldTypeOption,
  getTypeLabel,
  TYPE_LABELS,
  VariableTypeBadge,
  VariableTypeIcon,
} from "./variable-type/index.ts";

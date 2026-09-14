/**
 * Variables UI.
 *
 * The interface for defining prompt variables and mapping them onto the
 * sources a run can read: dataset columns, workflow node fields, or a literal
 * value.
 */

export { FormVariablesSection } from "./ui/sections/variables/form-variables-section.tsx";
export {
  VariablesSection,
  type VariablesSectionProps,
} from "./ui/sections/variables/variables-section.tsx";
export {
  PromptTextAreaWithVariables,
  type PromptTextAreaWithVariablesProps,
} from "./ui/sections/variables/prompt-textarea/prompt-textarea-with-variables.tsx";
export type { AvailableSource, Variable, FieldMapping } from "./ui/sections/variables/variables-section.tsx";
export {
  VariableMappingInput,
  type FieldType,
} from "./ui/sections/variables/variable-mapping-input.tsx";
export {
  VariableTypeIcon,
  FieldTypeSelect,
  VariableTypeBadge,
  TYPE_LABELS,
  getTypeLabel,
} from "./ui/sections/variables/variable-type/index.ts";

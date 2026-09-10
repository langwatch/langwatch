/**
 * Variables UI.
 *
 * The interface for defining prompt variables and mapping them onto the
 * sources a run can read: dataset columns, workflow node fields, or a literal
 * value.
 */

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
  VariableTypeIcon,
  FieldTypeSelect,
  VariableTypeBadge,
} from "./ui/sections/variables/variable-type/index.ts";

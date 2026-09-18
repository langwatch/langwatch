/**
 * Variables UI: defining prompt variables and mapping them onto the sources
 * a run can read - dataset columns, workflow node fields, or a literal value.
 */

export { FormVariablesSection } from "./ui/sections/variables/form-variables-section.tsx";
export {
  VariablesSection,
  type VariablesSectionProps,
} from "./ui/sections/variables/variables-section.tsx";
export { PromptTextAreaWithVariables } from "./ui/sections/variables/prompt-textarea/prompt-textarea-with-variables.tsx";
export type {
  PromptTextAreaOnAddMention,
  PromptTextAreaWithVariablesProps,
} from "./ui/sections/variables/prompt-textarea/prompt-textarea.types.ts";
export type {
  AvailableSource,
  Variable,
  FieldMapping,
} from "./ui/sections/variables/variables-section.tsx";
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
export { LayoutModeContext, useLayoutMode, type LayoutMode } from "./model/layout-mode.ts";

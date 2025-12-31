// Variables UI Components
// These components provide a reusable interface for defining and mapping variables
// across Evaluations V3, Optimization Studio, and Prompt Playground.

export {
  VariableMappingInput,
  type AvailableSource,
  type SourceType,
  type FieldMapping,
} from "./VariableMappingInput";

export {
  VariablesSection,
  type Variable,
  type VariablesSectionProps,
} from "./VariablesSection";

export {
  VariableInsertMenu,
  type SelectedField,
} from "./VariableInsertMenu";

export {
  PromptTextAreaWithVariables,
  type PromptTextAreaOnAddMention,
} from "./PromptTextAreaWithVariables";

export { FormVariablesSection } from "./FormVariablesSection";

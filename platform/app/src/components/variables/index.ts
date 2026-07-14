// Variables UI Components
// These components provide a reusable interface for defining and mapping variables
// across Evaluations V3, Optimization Studio, and Prompt Playground.

// Re-export from datasetUtils for convenience
export { datasetColumnTypeToFieldType } from "~/optimization_studio/utils/datasetUtils";
export {
  type PromptTextAreaOnAddMention,
  PromptTextAreaWithVariables,
} from "../prompt-textarea";
export { FormVariablesSection } from "./FormVariablesSection";
export {
  type SelectedField,
  VariableInsertMenu,
} from "./VariableInsertMenu";
export {
  type AvailableSource,
  type FieldMapping,
  type FieldType,
  type SourceType,
  VariableMappingInput,
} from "./VariableMappingInput";
export {
  type Variable,
  VariablesSection,
  type VariablesSectionProps,
} from "./VariablesSection";

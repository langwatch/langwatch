// Variables UI Components
// These components provide a reusable interface for defining and mapping variables
// across Evaluations V3, Optimization Studio, and Prompt Playground.

export {
  VariableMappingInput,
  type AvailableSource,
  type SourceType,
  type FieldMapping,
  type FieldType,
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
} from "../prompt-textarea";

export { FormVariablesSection } from "./FormVariablesSection";

// Re-export from datasetUtils for convenience
export { datasetColumnTypeToFieldType } from "~/optimization_studio/utils/datasetUtils";

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

/**
 * The prompt form contract: schema, values, stored-prompt mapping, and the
 * comparisons deciding whether an edit is savable. A surface, not
 * screen-private code - Prompt Studio, the drawer and the workflow studio share it.
 */
export {
  areFormValuesEqual,
  buildDefaultFormValues,
  changeHandleFormSchema,
  computeInitialFormValuesForPrompt,
  createChangeHandleFormSchema,
  DEFAULT_FORM_VALUES,
  getSaveBlockerMessage,
  inputsAndOutputsToDemostrationColumns,
  isNodeDataEqual,
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
  withDerivedDemonstrationColumns,
  type ChangeHandleFormValues,
} from "./model/prompt-form/index.ts";

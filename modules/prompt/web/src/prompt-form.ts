/**
 * The prompt form contract: schema, values, stored-prompt mapping, and the
 * comparisons that decide whether an edit is savable. A surface, not
 * screen-private code — Prompt Studio, the prompt drawer and the workflow
 * studio's signature panel all bind the same values, with different owners.
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

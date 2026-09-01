/**
 * The prompt form contract: the schema a prompt version is edited against, the
 * values that schema produces, and the pure comparisons that decide whether an
 * edit is savable.
 *
 * It is a surface rather than screen-private code because the prompt form is
 * edited from more than one place — Prompt Studio, the prompt drawer and the
 * workflow studio's signature panel all bind the same values — and each of
 * those is a different owner. The implementation is a package-wide portable
 * model; this entry is the exact public door onto it.
 */
export {
  areFormValuesEqual,
  buildDefaultFormValues,
  changeHandleFormSchema,
  createChangeHandleFormSchema,
  DEFAULT_FORM_VALUES,
  formSchema,
  formSchemaForSave,
  getSaveBlockerMessage,
  hasNonEmptySystemMessage,
  isNodeDataEqual,
  refinedFormSchemaWithModelLimits,
  versionMetadataSchema,
  versionMetadataToFormFormat,
  versionMetadataToNodeFormat,
  type ChangeHandleFormValues,
  type PromptConfigFormValues,
  type VersionMetadata,
} from "../../model/prompt-form";

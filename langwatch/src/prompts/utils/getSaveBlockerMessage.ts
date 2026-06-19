import type { UseFormReturn } from "react-hook-form";

import type { PromptConfigFormValues } from "~/prompts/types";

/**
 * Picks the most relevant user-facing message to surface in the
 * "Validation error" toast when a prompt save is blocked client-side.
 *
 * The system-prompt-required refinement (#3196) writes its error on
 * `version.configData.messages`, so that path takes precedence — it
 * carries the rule the user is most likely to see. Anything else falls
 * back to a generic copy.
 */
export const getSaveBlockerMessage = (
  methods: UseFormReturn<PromptConfigFormValues>,
): string => {
  const messagesError = methods.formState.errors.version?.configData
    ?.messages as { message?: string } | undefined;
  return (
    messagesError?.message ??
    "Please fix the configuration errors before saving"
  );
};

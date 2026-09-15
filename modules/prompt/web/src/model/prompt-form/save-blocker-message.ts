import type { UseFormReturn } from "react-hook-form";

import type { PromptConfigFormValues } from "@langwatch/prompt-contract";

/**
 * Picks the most relevant user-facing message for the "Validation error"
 * toast when a prompt save is blocked client-side. The system-prompt-required
 * refinement writes its error on `version.configData.messages`, so that path
 * takes precedence; anything else falls back to generic copy.
 */
export const getSaveBlockerMessage = (methods: UseFormReturn<PromptConfigFormValues>): string => {
  const messagesError = methods.formState.errors.version?.configData?.messages as
    | { message?: string }
    | undefined;
  return messagesError?.message ?? "Please fix the configuration errors before saving";
};

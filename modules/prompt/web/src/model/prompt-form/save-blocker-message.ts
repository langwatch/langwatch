import type { UseFormReturn } from "react-hook-form";

import type { PromptConfigFormValues } from "@langwatch/prompt-contract";

/**
 * Picks the message for the "Validation error" toast when a save is blocked
 * client-side. The system-prompt-required refinement's error on
 * `version.configData.messages` takes precedence; else generic copy.
 */
export const getSaveBlockerMessage = (methods: UseFormReturn<PromptConfigFormValues>): string => {
  const messagesError = methods.formState.errors.version?.configData?.messages as
    | { message?: string }
    | undefined;
  return messagesError?.message ?? "Please fix the configuration errors before saving";
};

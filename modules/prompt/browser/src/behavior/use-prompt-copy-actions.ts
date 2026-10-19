import { promptClient } from "@langwatch/prompt-client";

/** The writes that copy, duplicate or sync a prompt; each refreshes the prompt list. */
export function usePromptCopyActions() {
  const utils = promptClient.useUtils();
  const onSuccess = () => utils.prompts.getAllPromptsForProject.invalidate();
  return {
    copyPrompt: promptClient.prompts.copy.useMutation({ onSuccess }),
    duplicatePrompt: promptClient.prompts.duplicate.useMutation({ onSuccess }),
    syncFromSource: promptClient.prompts.syncFromSource.useMutation({ onSuccess }),
    pushToCopies: promptClient.prompts.pushToCopies.useMutation({ onSuccess }),
  };
}

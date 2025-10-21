import { useCallback } from "react";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { formValuesToTriggerSaveVersionParams } from "~/prompt-configs/utils/llmPromptConfigUtils";
import { toaster } from "~/components/ui/toaster";
import { type VersionedPrompt } from "~/server/prompt-config";
import { versionedPromptToPromptConfigFormValues } from "~/prompt-configs/utils/llmPromptConfigUtils";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";

/**
 * Hook to handle the saving of a prompt in the prompt studio.
 */
export function useHandleSavePrompt() {
  const { triggerSaveVersion } = usePromptConfigContext();
  const methods = useFormContext<PromptConfigFormValues>();
  const configId = methods.watch("configId");

  const handleSaveVersion = useCallback(() => {
    const values = methods.getValues();
    const data = formValuesToTriggerSaveVersionParams(values);
    const onSuccess = (prompt: VersionedPrompt) => {
      methods.reset(versionedPromptToPromptConfigFormValues(prompt));
      toaster.create({
        title: "Prompt saved",
        description: `Prompt ${prompt.handle} is now at version ${prompt.version}`,
        type: "success",
        closable: true,
      });
    };
    const onError = (error: Error) => {
      console.error(error);
      toaster.create({
        title: "Error saving version",
        description: error.message,
        type: "error",
        closable: true,
      });
    };
    if (!configId) {
      toaster.create({
        title: "Error saving version",
        description: "No config ID found",
        type: "error",
        closable: true,
      });
      return;
    }
    void triggerSaveVersion({ id: configId, data, onSuccess, onError });
  }, [triggerSaveVersion, configId, methods]);

  return { handleSaveVersion };
}

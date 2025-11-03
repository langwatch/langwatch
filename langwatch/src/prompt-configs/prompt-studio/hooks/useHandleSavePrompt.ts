import { useCallback } from "react";
import { cloneDeep } from "lodash";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { formValuesToTriggerSaveVersionParams } from "~/prompt-configs/utils/llmPromptConfigUtils";
import { toaster } from "~/components/ui/toaster";
import { type VersionedPrompt } from "~/server/prompt-config";
import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "~/prompt-configs/utils/llmPromptConfigUtils";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import {
  useDraggableTabsBrowserStore,
  type TabData,
} from "../prompt-studio-store/DraggableTabsBrowserStore";
import { useTabId } from "../components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";

/**
 * Hook to handle the saving of a prompt in the prompt studio.
 */
export function useHandleSavePrompt() {
  const { triggerSaveVersion, triggerCreatePrompt, triggerChangeHandle } =
    usePromptConfigContext();
  const methods = useFormContext<PromptConfigFormValues>();
  const configId = methods.watch("configId");
  const { updateTabData } = useDraggableTabsBrowserStore();
  const tabId = useTabId();

  const handleSaveVersion = useCallback(() => {
    const values = methods.getValues();
    const handle = values.handle;
    const data = formValuesToTriggerSaveVersionParams(values);
    const onSuccess = (prompt: VersionedPrompt) => {
      const newSavedState =
        versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);
      methods.reset(newSavedState);

      updateTabData({
        tabId,
        updater: (data: TabData) => ({
          ...data,
          form: {
            currentValues: cloneDeep(newSavedState),
          },
        }),
      });

      toaster.create({
        title: "Prompt saved",
        description: `Prompt ${prompt.handle} is now at version ${prompt.version}`,
        type: "success",
        meta: { closable: true },
      });
    };

    const onError = (error: Error) => {
      console.error(error);
      toaster.create({
        title: "Error saving",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    };

    /**
     * There is possibly legacy prompts that don't have a handle at this point.
     * So we trigger the change handle dialog to set the handle, and then trigger the save version.
     */
    if (!handle && configId) {
      /**
       * When the handle is changed, we need to save the prompt again to update the handle.
       * @param prompt - The prompt that was changed
       */
      const onSuccessChangeHandle = (prompt: VersionedPrompt) => {
        if (prompt.id !== configId) throw new Error("Prompt ID mismatch");
        triggerSaveVersion({ id: prompt.id, data, onSuccess, onError });
      };

      void triggerChangeHandle({
        id: configId,
        onSuccess: onSuccessChangeHandle,
        onError,
      });
    } else if (configId) {
      void triggerSaveVersion({ id: configId, data, onSuccess, onError });
    } else {
      void triggerCreatePrompt({ data, onSuccess, onError });
    }
  }, [
    triggerSaveVersion,
    configId,
    methods,
    triggerCreatePrompt,
    triggerChangeHandle,
    updateTabData,
    tabId,
  ]);

  return { handleSaveVersion };
}

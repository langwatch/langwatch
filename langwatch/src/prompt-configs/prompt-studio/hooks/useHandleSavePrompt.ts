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
  const { triggerSaveVersion, triggerCreatePrompt } = usePromptConfigContext();
  const methods = useFormContext<PromptConfigFormValues>();
  const configId = methods.watch("configId");
  const { updateTabData } = useDraggableTabsBrowserStore();
  const tabId = useTabId();

  const handleSaveVersion = useCallback(() => {
    const values = methods.getValues();
    console.log("values", values);
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

    if (configId) {
      void triggerSaveVersion({ id: configId, data, onSuccess, onError });
    } else {
      void triggerCreatePrompt({ data, onSuccess, onError });
    }
  }, [
    triggerSaveVersion,
    configId,
    methods,
    triggerCreatePrompt,
    updateTabData,
    tabId,
  ]);

  return { handleSaveVersion };
}

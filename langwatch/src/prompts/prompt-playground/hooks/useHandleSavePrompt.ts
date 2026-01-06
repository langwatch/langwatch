import cloneDeep from "lodash.clonedeep";
import { useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { toaster } from "~/components/ui/toaster";
import type { PromptConfigFormValues } from "~/prompts";
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";
import { usePromptConfigContext } from "~/prompts/providers/PromptConfigProvider";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";
import { useTabId } from "../components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";
import {
  type TabData,
  useDraggableTabsBrowserStore,
} from "../prompt-playground-store/DraggableTabsBrowserStore";

/**
 * Hook to handle the saving of a prompt in the prompt studio.
 * Single Responsibility: Orchestrates prompt save/create operations with proper validation and error handling.
 * @returns Object containing handleSaveVersion function
 */
export function useHandleSavePrompt() {
  const { triggerSaveVersion, triggerCreatePrompt, triggerChangeHandle } =
    usePromptConfigContext();
  const methods = useFormContext<PromptConfigFormValues>();
  const configId = methods.watch("configId");
  const currentVersion = methods.watch("versionMetadata.versionNumber");
  const { updateTabData } = useDraggableTabsBrowserStore(
    ({ updateTabData }) => ({ updateTabData }),
  );
  const tabId = useTabId();
  const utils = api.useContext();

  // Get the latest version from DB for accurate "Update to vX" display
  const { nextVersion } = useLatestPromptVersion({ configId, currentVersion });

  /**
   * handleSaveVersion
   * Single Responsibility: Validates handle, triggers appropriate save operation, and updates UI state on success/error.
   */
  const handleSaveVersion = useCallback(async () => {
    const isValid = await methods.trigger("version.configData.llm");
    if (!isValid) {
      toaster.create({
        title: "Validation error",
        description: "Please fix the LLM configuration errors before saving",
        type: "error",
        meta: { closable: true },
      });
      return;
    }

    const values = methods.getValues();
    const handle = values.handle;
    const data = formValuesToTriggerSaveVersionParams(values);
    /**
     * onSuccess
     * Single Responsibility: Updates form state and displays success message after prompt is saved.
     * @param prompt - The saved prompt with version information
     */
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
          meta: {
            ...data.meta,
            versionNumber: prompt.version,
          },
        }),
      });

      // Invalidate the query cache so useLatestPromptVersion gets the new version
      void utils.prompts.getByIdOrHandle.invalidate({
        idOrHandle: prompt.id,
      });

      toaster.create({
        title: "Prompt saved",
        description: `Prompt ${prompt.handle} is now at version ${prompt.version}`,
        type: "success",
        meta: { closable: true },
      });
    };

    /**
     * onError
     * Single Responsibility: Logs error and displays error message to user.
     * @param error - The error that occurred during save
     */
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
        triggerSaveVersion({
          id: prompt.id,
          data,
          nextVersion,
          onSuccess,
          onError,
        });
      };

      void triggerChangeHandle({
        id: configId,
        onSuccess: onSuccessChangeHandle,
        onError,
      });
    } else if (configId) {
      void triggerSaveVersion({
        id: configId,
        data,
        nextVersion,
        onSuccess,
        onError,
      });
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
    utils.prompts.getByIdOrHandle,
    nextVersion,
  ]);

  return { handleSaveVersion };
}

import { usePromptHost } from "../model/prompt-host";
import { cloneDeep } from "lodash-es";
import { useCallback } from "react";
import { useFormContext } from "react-hook-form";
import {
  getSaveBlockerMessage,
  type PromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "../model/prompt-form";
import { useLatestPromptVersion } from "./use-latest-prompt-version";
import { usePromptConfigContext } from "../model/prompt-config-context";
import { formValuesToTriggerSaveVersionParams } from "../model/prompt-node-conversion";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { promptApi } from "./prompt-api";
import { useTabId } from "../model/prompt-tab-context";
import type { TabData } from "../model/prompt-tabs-store";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store";

/**
 * Hook to handle the saving of a prompt in the prompt studio.
 * Single Responsibility: Orchestrates prompt save/create operations with proper validation and error handling.
 * @returns Object containing handleSaveVersion function
 */
export function useHandleSavePrompt() {
  const { triggerSaveVersion, triggerCreatePrompt, triggerChangeHandle } = usePromptConfigContext();
  const methods = useFormContext<PromptConfigFormValues>();
  const configId = methods.watch("configId");
  const currentVersion = methods.watch("versionMetadata.versionNumber");
  const { updateTabData } = useDraggableTabsBrowserStore(({ updateTabData }) => ({
    updateTabData,
  }));
  const tabId = useTabId();
  const utils = promptApi.useUtils();
  const host = usePromptHost();

  // Get the latest version from DB for accurate "Update to vX" display
  const { nextVersion } = useLatestPromptVersion({ configId, currentVersion });

  /**
   * handleSaveVersion
   * Single Responsibility: Validates handle, triggers appropriate save operation, and updates UI state on success/error.
   */
  const handleSaveVersion = useCallback(async () => {
    // Validate the full form so the save-time refinement (#3196: system
    // prompt required) fires alongside the LLM config rules.
    const isValid = await methods.trigger();
    if (!isValid) {
      host.failed({
        error: new Error(getSaveBlockerMessage(methods)),
        fallbackTitle: getSaveBlockerMessage(methods),
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
      const newSavedState = versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);
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

      host.succeeded({
        title: "Prompt saved",
        description: `Prompt ${prompt.handle} is now at version ${prompt.version}`,
      });
    };

    /**
     * onError
     * Single Responsibility: Logs error and displays error message to user.
     * @param error - The error that occurred during save
     */
    const onError = (error: Error) => {
      // No form bridge here on purpose. The only top-level (claimable) values
      // on the prompt form are `handle`, `scope` and `configId`, and the
      // playground renders none of them as an input — the handle is read-only
      // in the header and changed through its own dialog.
      // `applyHandledErrorToForm` would claim a `handle` field error, set it on
      // a field nobody paints, and suppress this toast — the user would hit
      // Save and see nothing at all. Toast until there is a field to put the
      // message on.
      host.failed({ error, fallbackTitle: "Couldn't save the prompt" });
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

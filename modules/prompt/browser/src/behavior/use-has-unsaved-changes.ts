import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import { useMemo } from "react";
import type { DeepPartial } from "react-hook-form";

import {
  areFormValuesEqual,
  computeInitialFormValuesForPrompt,
} from "../model/prompt-form/index.ts";
import { usePromptDefaultModel } from "./use-prompt-default-model.ts";
import { usePromptVersion } from "./use-prompt-version.ts";
import { useTabById } from "./use-tab-by-id.ts";

/**
 * Whether the prompt in this tab has unsaved changes: form values against the LOADED version
 * (not latest), so an older version with no edits shows none and "Update" stays on for rollback.
 * @param tabId - The ID of the tab to check for unsaved changes
 * @param liveValues - The mounted form's values; read in place of the tab's
 *   debounced mirror of them, which trails an edit by half a second
 * @returns true if there are unsaved changes, false otherwise
 */
export function useHasUnsavedChanges({
  tabId,
  liveValues,
}: {
  tabId: string;
  liveValues?: DeepPartial<PromptConfigFormValues>;
}): boolean {
  const tab = useTabById(tabId);

  // Cascade-resolved model for new-prompt defaults used when computing
  // baseline form values to compare against.
  const resolvedDefault = usePromptDefaultModel();
  const resolvedDefaultModel = resolvedDefault.data?.model;

  const currentValues = liveValues ?? tab?.data.form.currentValues;
  const configId = currentValues?.configId;
  const handle = currentValues?.handle;
  // Get the version ID from the form to compare against the correct version
  const versionId = currentValues?.versionMetadata?.versionId;

  // Fetch the specific version that's loaded in the form, not the latest
  const { data: savedPrompt, isLoading: isLoadingSavedPrompt } = usePromptVersion({
    idOrHandle: configId,
    versionId,
  });

  return useMemo(() => {
    // Never been saved
    if (!configId) return true;
    // No handle
    if (!handle) return true;
    // Still loading the saved prompt
    if (isLoadingSavedPrompt) return false;
    // No saved prompt found, never been saved?
    if (!savedPrompt) return true;
    // No current values, still creating store for form
    if (!currentValues) return false;

    const savedValues = computeInitialFormValuesForPrompt({
      prompt: savedPrompt,
      defaultModel: resolvedDefaultModel,
      useSystemMessage: true,
    });

    return !areFormValuesEqual(savedValues, currentValues);
  }, [configId, savedPrompt, currentValues, resolvedDefaultModel, isLoadingSavedPrompt, handle]);
}

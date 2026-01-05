import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { areFormValuesEqual } from "~/prompts/utils/areFormValuesEqual";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import { api } from "~/utils/api";
import { useDraggableTabsBrowserStore } from "../prompt-playground-store/DraggableTabsBrowserStore";

/**
 * Determines whether the prompt in the specified tab has unsaved changes.
 * Single Responsibility: Compare current form values against the version currently loaded in the form.
 *
 * This compares against the LOADED version (via versionId), not the latest version.
 * This means loading an older version and making no changes = no unsaved changes.
 * The "Update" button should still be enabled for older versions to allow "rollback".
 *
 * @param tabId - The ID of the tab to check for unsaved changes
 * @returns true if there are unsaved changes, false otherwise
 */
export function useHasUnsavedChanges(tabId: string): boolean {
  const { project } = useOrganizationTeamProject();
  const tab = useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );

  const configId = tab?.data.form.currentValues.configId;
  const currentValues = tab?.data.form.currentValues;
  const handle = tab?.data.form.currentValues.handle;
  // Get the version ID from the form to compare against the correct version
  const versionId = tab?.data.form.currentValues.versionMetadata?.versionId;

  // Fetch the specific version that's loaded in the form, not the latest
  const { data: savedPrompt, isLoading: isLoadingSavedPrompt } =
    api.prompts.getByIdOrHandle.useQuery(
      {
        idOrHandle: configId ?? "",
        projectId: project?.id ?? "",
        versionId: versionId, // Fetch the specific version loaded in the form
      },
      {
        enabled: !!configId && !!project?.id,
      },
    );

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

    const projectDefaultModel = project?.defaultModel;
    const normalizedDefaultModel =
      typeof projectDefaultModel === "string" ? projectDefaultModel : undefined;

    const savedValues = computeInitialFormValuesForPrompt({
      prompt: savedPrompt,
      defaultModel: normalizedDefaultModel,
      useSystemMessage: true,
    });

    return !areFormValuesEqual(savedValues, currentValues);
  }, [
    configId,
    savedPrompt,
    currentValues,
    project?.defaultModel,
    isLoadingSavedPrompt,
    handle,
  ]);
}

import { useMemo } from "react";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";
import { areFormValuesEqual } from "~/prompt-configs/utils/areFormValuesEqual";

/**
 * Determines whether the prompt in the specified tab has unsaved changes.
 * Single Responsibility: Compare current form values against saved prompt state to detect unsaved changes.
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

  const { data: savedPrompt, isLoading: isLoadingSavedPrompt } =
    api.prompts.getByIdOrHandle.useQuery(
      {
        idOrHandle: configId ?? "",
        projectId: project?.id ?? "",
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

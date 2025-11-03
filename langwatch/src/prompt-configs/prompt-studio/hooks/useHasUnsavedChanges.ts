import { useMemo } from "react";
import { isEqual } from "lodash";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";
import { type PromptConfigFormValues } from "~/prompt-configs";
import type { DeepPartial } from "react-hook-form";

/**
 * Compare two form values for deep equality after JSON normalization.
 * Single Responsibility: Normalize and compare form values to detect changes.
 */
function areFormValuesEqual(
  a?: DeepPartial<PromptConfigFormValues>,
  b?: DeepPartial<PromptConfigFormValues>,
): boolean {
  if (!a || !b) return false;
  // Use JSON.stringify to normalize the objects for comparison (ie Dates, etc)
  return isEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}

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

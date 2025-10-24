import { useMemo } from "react";
import { isEqual } from "lodash";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";
import { type PromptConfigFormValues } from "~/prompt-configs/types";
import type { DeepPartial } from "react-hook-form";

function compareFormValues(
  a?: DeepPartial<PromptConfigFormValues>,
  b?: DeepPartial<PromptConfigFormValues>,
): boolean {
  if (!a || !b) return false;
  return (
    a.configId === b.configId &&
    a.handle === b.handle &&
    a.scope === b.scope &&
    isEqual(a.version, b.version)
  );
}

export function useHasUnsavedChanges(tabId: string): boolean {
  const { project } = useOrganizationTeamProject();
  const tab = useDraggableTabsBrowserStore((state) =>
    state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );

  const configId = tab?.data.form.currentValues.configId;
  const currentValues = tab?.data.form.currentValues;

  const { data: savedPrompt } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: configId!,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!configId && !!project?.id,
    },
  );

  return useMemo(() => {
    if (!configId) return true;
    if (!savedPrompt) return false;

    const projectDefaultModel = project?.defaultModel;
    const normalizedDefaultModel =
      typeof projectDefaultModel === "string" ? projectDefaultModel : undefined;

    const savedValues = computeInitialFormValuesForPrompt({
      prompt: savedPrompt,
      defaultModel: normalizedDefaultModel,
      useSystemMessage: true,
    });

    return !currentValues || !compareFormValues(savedValues, currentValues);
  }, [configId, savedPrompt, currentValues, project?.defaultModel]);
}

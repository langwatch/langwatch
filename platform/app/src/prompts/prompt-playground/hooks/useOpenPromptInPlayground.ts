import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { api } from "~/utils/api";
import { useDraggableTabsBrowserStore } from "../prompt-playground-store/DraggableTabsBrowserStore";

/** Opens a saved prompt with the same defaults from the rail and empty states. */
export function useOpenPromptInPlayground() {
  const { project } = useOrganizationTeamProject();
  const addTab = useDraggableTabsBrowserStore((state) => state.addTab);
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );

  return useCallback(
    (prompt: VersionedPrompt) => {
      const values = computeInitialFormValuesForPrompt({
        prompt,
        defaultModel: resolvedDefault.data?.model ?? "",
        useSystemMessage: true,
      });
      addTab({
        data: {
          chat: { initialMessagesFromSpanData: [] },
          form: { currentValues: values },
          meta: {
            title: values.handle ?? null,
            versionNumber: values.versionMetadata?.versionNumber,
          },
          variableValues: {},
        },
      });
    },
    [addTab, resolvedDefault.data?.model],
  );
}

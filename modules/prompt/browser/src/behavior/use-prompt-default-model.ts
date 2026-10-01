import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

/** The cascade-resolved model a new prompt starts with; `data` is null when none is configured. */
export function usePromptDefaultModel({ enabled = true }: { enabled?: boolean } = {}) {
  const { project } = usePromptProject();
  const projectId = project?.id ?? "";
  return promptApi.modelProvider.getResolvedDefault.useQuery(
    { projectId, featureKey: "prompt.create_default" },
    { enabled: enabled && !!projectId },
  );
}

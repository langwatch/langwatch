import type { Node } from "@xyflow/react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { api } from "~/utils/api";

export function useVersionDrift(node: Node<LlmPromptConfigComponent>) {
  const { project } = useOrganizationTeamProject();
  const { configId, handle } = node.data;
  const idOrHandle = configId ?? handle ?? "";
  const {
    data: latestPrompt,
    isLoading: isLoadingPrompt,
    isFetching: isFetchingLatestPrompt,
  } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!idOrHandle && !!project?.id,
    }
  );

  return {
    nodeVersion: node.data.versionMetadata?.versionNumber,
    isLoading: isLoadingPrompt || isFetchingLatestPrompt,
    latestPromptVersion: latestPrompt?.version,
    isOutdated:
      (latestPrompt?.version ?? 0) >
      (node.data.versionMetadata?.versionNumber ?? 0),
  };
}

import { promptClient } from "@langwatch/prompt-client";

import { usePromptProject } from "./use-prompt-project.ts";

/** One stored prompt: the latest version, or the one named by `versionId`. */
export function usePromptVersion({
  idOrHandle,
  versionId,
  enabled = true,
}: {
  idOrHandle: string | undefined;
  versionId?: string | undefined;
  enabled?: boolean;
}) {
  const { project } = usePromptProject();
  const projectId = project?.id ?? "";
  return promptClient.prompts.getByIdOrHandle.useQuery(
    { idOrHandle: idOrHandle ?? "", projectId, ...(versionId ? { versionId } : {}) },
    { enabled: enabled && !!idOrHandle && !!projectId },
  );
}

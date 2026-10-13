import { promptClient } from "@langwatch/prompt-client";

import { usePromptProject } from "./use-prompt-project.ts";

/** Whether the caller may modify (rename, delete) the prompt; `data` is unset until answered. */
export function useCanModifyPrompt({ promptId, enabled }: { promptId: string; enabled: boolean }) {
  const { project } = usePromptProject();
  const projectId = project?.id ?? "";
  return promptClient.prompts.checkModifyPermission.useQuery(
    { idOrHandle: promptId, projectId },
    { enabled: enabled && !!projectId },
  );
}

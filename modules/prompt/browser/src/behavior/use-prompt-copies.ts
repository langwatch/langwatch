import { promptClient } from "@langwatch/prompt-client";

import { usePromptProject } from "./use-prompt-project.ts";

/** The replicas copied from a prompt. */
export function usePromptCopies({ promptId, enabled }: { promptId: string; enabled: boolean }) {
  const { project } = usePromptProject();
  const projectId = project?.id ?? "";
  return promptClient.prompts.getCopies.useQuery(
    { projectId, idOrHandle: promptId },
    { enabled: enabled && !!projectId && !!promptId },
  );
}

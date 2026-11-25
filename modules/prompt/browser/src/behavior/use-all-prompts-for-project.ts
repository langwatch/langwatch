import { promptClient } from "@langwatch/prompt-client";

import { usePromptProject } from "./use-prompt-project.ts";

/**
 * useAllPromptsForProject
 * Single Responsibility: Fetch all prompts for the current project.
 * @returns Query result containing prompts for the project
 */
export function useAllPromptsForProject() {
  const { projectId } = usePromptProject();
  return promptClient.prompts.getAllPromptsForProject.useQuery(
    {
      projectId: projectId,
    },
    {
      enabled: !!projectId,
    },
  );
}

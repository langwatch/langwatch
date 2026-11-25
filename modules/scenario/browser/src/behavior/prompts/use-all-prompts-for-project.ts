import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { promptClient } from "@langwatch/prompt-client";

/** The project's prompts; the one read every scenario surface shares. */
export function useAllPromptsForProject({ enabled = true }: { enabled?: boolean } = {}) {
  const { projectId = "" } = useOrganizationTeamProject();
  return promptClient.prompts.getAllPromptsForProject.useQuery(
    { projectId },
    {
      enabled: !!projectId && enabled,
    },
  );
}

import { useMemo } from "react";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Fetches agents and prompts for the current project and builds a
 * Map<id, displayName> so callers can resolve target reference IDs
 * to human-readable names.
 */
export function useTargetNameMap(): Map<string, string> {
  const { project } = useOrganizationTeamProject();

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  return useMemo(() => {
    const map = new Map<string, string>();
    if (agents) {
      for (const agent of agents) {
        map.set(agent.id, agent.name);
      }
    }
    if (prompts) {
      for (const prompt of prompts) {
        map.set(prompt.id, prompt.handle ?? prompt.id);
      }
    }
    return map;
  }, [agents, prompts]);
}

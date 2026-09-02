/**
 * Target reference ids, resolved to names a person recognises.
 *
 * The application's `~/hooks/useTargetNameMap` went to `@langwatch/experiment-web`
 * with the experiments workbench while this family was moving; naming that
 * package from here would be a web-to-web edge onto a family whose transport
 * and host port are not this one's. The read is two queries and a Map, and both
 * queries are already in this family's procedure map, so it is stated here
 * against this family's transport instead.
 */

import { useMemo } from "react";

import { api } from "../behavior/scenario-api";
import { useOrganizationTeamProject } from "../behavior/use-organization-team-project";

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
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    for (const prompt of prompts ?? []) {
      // Prefer the globally-unique handle, then the plain name (always
      // present), then the id as last resort. This keeps placeholder prompts
      // (no handle yet) from collapsing to their raw cuid.
      map.set(prompt.id, prompt.handle ?? prompt.name ?? prompt.id);
    }
    return map;
  }, [agents, prompts]);
}

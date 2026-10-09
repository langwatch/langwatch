/**
 * The parameters the agents of the project declare, for a field that has no run to read them
 * from: the scenario editor offers them so a scenario can name an agent's parameter and one
 * of its options.
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo } from "react";

import { useAgents } from "../../../../behavior/agents/use-agents.ts";
import {
  type DeclaredParameter,
  unionParameterDefinitions,
} from "../../../../behavior/suites/use-run-suite.ts";

export function useAgentDeclaredParameters(): DeclaredParameter[] {
  const { project } = useOrganizationTeamProject();
  const { data: agents } = useAgents({ projectId: project?.id });
  return useMemo(
    () =>
      unionParameterDefinitions({
        scenarioIds: [],
        scenarios: [],
        agents: agents ?? [],
      }),
    [agents],
  );
}

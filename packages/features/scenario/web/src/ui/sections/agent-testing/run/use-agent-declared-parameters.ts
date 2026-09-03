/**
 * The parameters the agents of the project declare, for a field that has no
 * run to read them from: the scenario editor offers them so a scenario can
 * name an agent's parameter and one of its options.
 *
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */

import { useMemo } from "react";
import {
  type DeclaredParameter,
  unionParameterDefinitions,
} from "../../../../behavior/suites/use-run-suite";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/scenario-api";

export function useAgentDeclaredParameters(): DeclaredParameter[] {
  const { project } = useOrganizationTeamProject();
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
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

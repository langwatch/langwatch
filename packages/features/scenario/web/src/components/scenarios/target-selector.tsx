import {
  filterScenarioTargetAgents,
  isScenarioAgentTarget,
  ScenarioTargetSelector,
  type ScenarioTarget,
  type ScenarioTargetAgent,
} from "../../index";
import { agentHasDevTunnel } from "@langwatch/agent-web/surfaces/browser-port";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { useAllPromptsForProject } from "../../prompts/hooks/use-all-prompts-for-project";
import { api } from "../../behavior/scenario-api";

export type TargetValue = ScenarioTarget;

export { isScenarioAgentTarget as isAgentTarget };

export function useFilteredAgents(agents: ScenarioTargetAgent[] | undefined, searchValue: string) {
  return useMemo(() => filterScenarioTargetAgents(agents, searchValue), [agents, searchValue]);
}

export function TargetSelector({
  value,
  onChange,
  onCreateAgent,
  onCreatePrompt,
  placeholder,
}: {
  value: TargetValue;
  onChange(value: TargetValue): void;
  onCreateAgent?(): void;
  onCreatePrompt?(): void;
  placeholder?: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { data: prompts } = useAllPromptsForProject();
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const scenarioAgents = useMemo(
    () =>
      agents?.map((agent) => ({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        updatedAt: agent.updatedAt,
        hasDevTunnel: agentHasDevTunnel(agent),
      })),
    [agents],
  );

  return (
    <ScenarioTargetSelector
      value={value}
      onChange={onChange}
      prompts={prompts}
      agents={scenarioAgents}
      onCreateAgent={onCreateAgent}
      onCreatePrompt={onCreatePrompt}
      placeholder={placeholder}
    />
  );
}

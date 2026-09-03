import { ScenarioTargetSelector, type ScenarioTarget } from "../../../index";
import { agentHasDevTunnel } from "@langwatch/agent-web/surfaces/browser-port";
import { useMemo } from "react";
import { useSession } from "../../../behavior/auth-session";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useAllPromptsForProject } from "../../../behavior/prompts/use-all-prompts-for-project";
import { api } from "../../../behavior/scenario-api";

export type TargetValue = ScenarioTarget;

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
  // Read without requiring a session: the page is already behind the sign-in
  // gate, and only a development agent's ownership depends on who is reading.
  const { data: session } = useSession();
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
        environment: agent.environment,
        status: agent.status,
        owner: agent.owner,
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
      viewerUserId={session?.user?.id ?? null}
    />
  );
}

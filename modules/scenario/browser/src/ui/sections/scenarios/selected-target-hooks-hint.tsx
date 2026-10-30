import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";

import { useAgents } from "../../../behavior/agents/use-agents.ts";
import type { TargetValue } from "../../../model/scenario-target.ts";
import { ConnectedAgentHooksHint } from "../../elements/connected-agent-hooks-hint.tsx";

/** The hooks line of the scenario editor, only while the chosen target is a connected agent. */
export function SelectedTargetHooksHint({ target }: { target: TargetValue }) {
  const { project } = useOrganizationTeamProject();
  const { data: agents } = useAgents({
    projectId: project?.id,
    enabled: target?.type === "connected",
  });
  if (target?.type !== "connected") return null;

  const agent = agents?.find((candidate) => candidate.id === target.id);
  if (!agent) return null;

  return <ConnectedAgentHooksHint status={agent.status} config={agent.config} />;
}

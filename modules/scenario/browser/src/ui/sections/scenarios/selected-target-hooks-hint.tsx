/**
 * The hooks line of the scenario editor (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Box } from "@langwatch/design-system/primitives";

import { useAgents } from "../../../behavior/agents/use-agents.ts";
import type { TargetValue } from "../../../model/scenario-target.ts";
import { ConnectedAgentHooksHint } from "../../elements/connected-agent-hooks-hint.tsx";

export function SelectedTargetHooksHint({ target }: { target: TargetValue }) {
  const { project } = useOrganizationTeamProject();
  const { data: agents } = useAgents({
    projectId: project?.id,
    enabled: target?.type === "connected",
  });
  if (target?.type !== "connected") return null;

  const agent = agents?.find((candidate) => candidate.id === target.id);
  if (!agent) return null;

  return (
    <Box marginBottom={4}>
      <ConnectedAgentHooksHint status={agent.status} config={agent.config} />
    </Box>
  );
}

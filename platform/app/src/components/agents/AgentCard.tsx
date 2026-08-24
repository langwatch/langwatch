import type { Agent } from "@langwatch/agent-contract";
import {
  AgentCard as PresentationalAgentCard,
  type AgentCardProps as PresentationalAgentCardProps,
} from "@langwatch/agent-web";
import type { AgentWithFields as TypedAgent } from "@langwatch/agent-contract";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { agentContextChip } from "~/features/langy/logic/langyContextChips";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

export type AgentCardProps = Omit<
  PresentationalAgentCardProps,
  "agent" | "updatedAtLabel"
> & {
  agent: TypedAgent;
};

export function AgentCard({ agent, ...callbacks }: AgentCardProps) {
  const presentationalAgent: Agent = {
    ...agent,
    copyCount: agent.copyCount,
  };

  return (
    <LangyContextTarget
      target={agentContextChip({ agentId: agent.id, name: agent.name })}
    >
      <PresentationalAgentCard
        agent={presentationalAgent}
        updatedAtLabel={
          formatTimeAgo(new Date(agent.updatedAt).getTime()) ?? ""
        }
        {...callbacks}
      />
    </LangyContextTarget>
  );
}

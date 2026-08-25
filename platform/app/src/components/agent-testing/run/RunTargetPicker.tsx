/**
 * The agent side of the run dialog's target area: the agents as blocks.
 *
 * A project with nothing to run against shows one dotted "Setup agent" box
 * that opens the agent setup.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Code, Globe, Plug, Workflow } from "lucide-react";
import { agentHasDevTunnel } from "~/components/agents/LocalTunnelBadge";
import type { TargetValue } from "~/components/scenarios/TargetSelector";

const AGENT_ICONS = {
  http: Globe,
  code: Code,
  workflow: Workflow,
} as const;

/** An agent the run dialog can offer: one of the scenario target kinds. */
export type RunDialogAgent = {
  id: string;
  name: string;
  type: "http" | "code" | "workflow";
  config?: unknown;
};

/** The agents of the project as blocks, the selected one marked. */
export function AgentBlocks({
  agents,
  selected,
  onSelect,
}: {
  agents: RunDialogAgent[];
  selected: TargetValue;
  onSelect: (target: NonNullable<TargetValue>) => void;
}) {
  return (
    <Grid
      templateColumns="repeat(3, 1fr)"
      gap={2}
      data-testid="run-dialog-agents"
    >
      {agents.map((agent) => (
        <AgentBlock
          key={agent.id}
          agent={agent}
          isActive={selected?.type !== "prompt" && selected?.id === agent.id}
          onSelect={onSelect}
        />
      ))}
    </Grid>
  );
}

/** One agent block: its kind, its name, and its tunnel state when it has one. */
function AgentBlock({
  agent,
  isActive,
  onSelect,
}: {
  agent: RunDialogAgent;
  isActive: boolean;
  onSelect: (target: NonNullable<TargetValue>) => void;
}) {
  const AgentIcon = AGENT_ICONS[agent.type];

  return (
    <Box
      as="button"
      textAlign="left"
      cursor="pointer"
      borderWidth="1px"
      borderColor={isActive ? "blue.500" : "border"}
      background={isActive ? "blue.subtle" : undefined}
      _hover={{ background: isActive ? "blue.subtle" : "bg.muted" }}
      borderRadius="lg"
      paddingX={3}
      paddingY={2.5}
      onClick={() => onSelect({ type: agent.type, id: agent.id })}
      data-testid={`run-dialog-agent-${agent.id}`}
      aria-pressed={isActive}
    >
      <HStack justify="space-between">
        <AgentIcon size={14} color="var(--chakra-colors-fg-muted)" />
        {isActive && <Check size={14} color="var(--chakra-colors-blue-500)" />}
      </HStack>
      <Text fontSize="sm" fontWeight="medium" truncate marginTop={2}>
        {agent.name}
      </Text>
      {agentHasDevTunnel(agent) && <AgentOnlineBadge agentId={agent.id} />}
    </Box>
  );
}

/** Says the agent is reachable through a dev tunnel right now. */
function AgentOnlineBadge({ agentId }: { agentId: string }) {
  return (
    <HStack gap={1.5} marginTop={1} data-testid={`agent-online-${agentId}`}>
      <Box boxSize={2} borderRadius="full" background="green.500" />
      <Text fontSize="xs" color="fg.muted">
        online
      </Text>
    </HStack>
  );
}

/** The dotted box a project with nothing to test shows in place of the list. */
export function SetupAgentBox({ onSetup }: { onSetup: () => void }) {
  return (
    <VStack
      as="button"
      cursor="pointer"
      width="full"
      gap={1}
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      borderRadius="lg"
      paddingY={6}
      _hover={{ background: "bg.muted" }}
      onClick={onSetup}
      data-testid="run-dialog-setup-agent"
    >
      <Plug size={16} color="var(--chakra-colors-fg-subtle)" />
      <Text fontSize="sm" fontWeight="medium">
        Setup agent
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Connect the agent you want to test
      </Text>
    </VStack>
  );
}

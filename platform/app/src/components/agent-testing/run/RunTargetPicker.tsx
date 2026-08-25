/**
 * The agent side of the run dialog's target area: the agents as cards.
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
import { FG_FAINT, FG_MUTED } from "../shared/design";

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

/** The agents of the project as cards, the selected one marked. */
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

/** One agent card: its kind, its name, and how it can be reached. */
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
  const isOnline = agentHasDevTunnel(agent);

  return (
    <Box
      as="button"
      textAlign="left"
      cursor="pointer"
      borderWidth="1px"
      borderColor={isActive ? "blue.500" : "border"}
      background={isActive ? "blue.subtle" : undefined}
      _hover={{ background: isActive ? "blue.subtle" : "bg.muted/60" }}
      borderRadius="xl"
      paddingX={3}
      paddingY={2.5}
      onClick={() => onSelect({ type: agent.type, id: agent.id })}
      data-testid={`run-dialog-agent-${agent.id}`}
      aria-pressed={isActive}
    >
      <HStack justify="space-between" align="start">
        <HStack
          justify="center"
          boxSize="24px"
          borderRadius="md"
          background="blue.subtle"
          color="blue.fg"
        >
          <AgentIcon size={13} />
        </HStack>
        {isActive && <Check size={14} color="var(--chakra-colors-blue-500)" />}
      </HStack>
      <Text fontSize="12.5px" fontWeight="medium" truncate marginTop={3}>
        {agent.name}
      </Text>
      {/* Only a dev tunnel says whether an agent is reachable right now, so
          an agent without one carries no state it cannot vouch for. The row
          keeps its height either way, so the cards line up. */}
      <HStack
        gap={1.5}
        marginTop={1}
        minHeight="16px"
        data-testid={isOnline ? `agent-online-${agent.id}` : undefined}
      >
        {isOnline && (
          <>
            <Box
              boxSize="8px"
              borderRadius="full"
              flexShrink={0}
              background="green.500"
            />
            <Text fontSize="11px" color={FG_MUTED} truncate>
              online
            </Text>
          </>
        )}
      </HStack>
    </Box>
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
      borderRadius="xl"
      paddingX={4}
      paddingY={6}
      _hover={{ background: "bg.muted/50" }}
      onClick={onSetup}
      data-testid="run-dialog-setup-agent"
    >
      <Plug size={16} color="var(--chakra-colors-fg-muted)" />
      <Text fontSize="12.5px" fontWeight="medium">
        Setup agent
      </Text>
      <Text fontSize="11.5px" color={FG_FAINT}>
        Connect the agent you want to test
      </Text>
    </VStack>
  );
}

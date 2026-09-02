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
import { agentHasDevTunnel } from "@langwatch/agent-web/surfaces/browser-port";
import type { TargetValue } from "../../scenarios/target-selector";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../../../../model/agent-testing/shared/design";

const AGENT_ICONS = {
  http: Globe,
  code: Code,
  workflow: Workflow,
} as const;

/**
 * What an agent card stands at: its icon row, its name and the line under it.
 *
 * Stated rather than left to the content so the "Setup agent" box, which holds
 * different words, is exactly one card and not a taller one.
 */
const AGENT_CARD_HEIGHT = "95px";

/** The three-across grid the agent cards and the setup box both sit in. */
const AGENT_GRID_COLUMNS = "repeat(3, 1fr)";

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
      templateColumns={AGENT_GRID_COLUMNS}
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
  const hasDevTunnel = agentHasDevTunnel(agent);

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
      height={AGENT_CARD_HEIGHT}
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
      {/* The row keeps its height with or without the line, so the cards
          line up. */}
      <HStack
        gap={1.5}
        marginTop={1}
        minHeight="16px"
        data-testid={hasDevTunnel ? `agent-dev-tunnel-${agent.id}` : undefined}
      >
        {hasDevTunnel && (
          <>
            <Box
              boxSize="8px"
              borderRadius="full"
              flexShrink={0}
              background="orange.500"
            />
            <Text fontSize="11px" color={FG_MUTED} truncate>
              Local tunnel
            </Text>
          </>
        )}
      </HStack>
    </Box>
  );
}

/**
 * The dotted box a project with nothing to test shows in place of the list.
 *
 * It takes one cell of the same grid the agent cards sit in, so it reads as
 * the first card of a list that is still empty rather than as a banner.
 */
export function SetupAgentBox({ onSetup }: { onSetup: () => void }) {
  return (
    <Grid templateColumns={AGENT_GRID_COLUMNS} gap={2}>
      <VStack
        as="button"
        cursor="pointer"
        boxShadow={QUIET_BUTTON_SHADOW}
        justify="center"
        gap={1}
        height={AGENT_CARD_HEIGHT}
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border.emphasized"
        borderRadius="xl"
        paddingX={3}
        textAlign="center"
        _hover={{ background: "bg.muted/50" }}
        onClick={onSetup}
        data-testid="run-dialog-setup-agent"
      >
        <Plug size={16} color="var(--chakra-colors-fg-muted)" />
        <Text fontSize="12.5px" fontWeight="medium">
          Setup agent
        </Text>
        <Text fontSize="11px" color={FG_MUTED} lineHeight="1.25">
          Connect the agent you want to test
        </Text>
      </VStack>
    </Grid>
  );
}

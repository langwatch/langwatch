/**
 * The connected agents of a project, as cards of the agents page (ADR-128).
 *
 * One card is one name in one environment: the process in production, the
 * one on a shared staging box, and one for every developer who runs it on
 * their laptop. The card carries the presence, the name with its
 * environment, the SDK that registered it and who it belongs to. It is the
 * same card the HTTP and the code agents are drawn in, so one page reads as
 * one list. The run parameters it declares are read in its drawer.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { Bot, ExternalLink, Laptop, Play, User } from "lucide-react";
import { LuTrash2 } from "react-icons/lu";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  AgentCardIcon,
  AgentCardMenuTrigger,
  AgentCardShell,
} from "@langwatch/agent-web/screens/agent-management";
import type { ConnectedAgentView } from "@langwatch/agent-contract";
import {
  environmentTone,
  instanceCountLabel,
  presenceLabel,
  scopeOf,
  sdkLabel,
  sortConnectedAgents,
} from "./connected-agent-rows";

/**
 * The connected agents as cards.
 *
 * The cards are drawn straight into the grid of the agents page, so they sit
 * beside the agents of every other kind at the same size.
 */
export function ConnectedAgentsSection({
  agents,
  onOpen,
  onDelete,
  onTest,
}: {
  agents: ConnectedAgentView[];
  onOpen: (agent: ConnectedAgentView) => void;
  onDelete?: (agent: ConnectedAgentView) => void;
  /** Runs one scripted scenario against the agent and opens the run. */
  onTest?: (agent: ConnectedAgentView) => void;
}) {
  return (
    <>
      {sortConnectedAgents(agents).map((agent) => (
        <ConnectedAgentCard
          key={agent.id}
          agent={agent}
          onOpen={() => onOpen(agent)}
          onDelete={onDelete ? () => onDelete(agent) : undefined}
          onTest={onTest ? () => onTest(agent) : undefined}
        />
      ))}
    </>
  );
}

/**
 * The dot and the word that say whether a process holds the agent.
 *
 * The header carries the word alone, and the tooltip carries the rest: how
 * many instances hold it, or when it was last seen.
 */
function PresenceMark({ agent }: { agent: ConnectedAgentView }) {
  const label = presenceLabel({
    status: agent.status,
    instanceCount: agent.instances.length,
    lastSeenAt: agent.lastSeenAt,
  });
  const isOnline = agent.status === "online";
  return (
    <Tooltip content={label}>
      <HStack
        gap={1.5}
        flexShrink={0}
        aria-label={label}
        data-testid={`connected-agent-status-${agent.status}`}
      >
        <Box boxSize="8px" borderRadius="full" background={isOnline ? "green.500" : "gray.400"} />
        <Text fontSize="12px" color="fg.muted">
          {isOnline ? "Online" : "Offline"}
        </Text>
      </HStack>
    </Tooltip>
  );
}

/** The environment beside the name, in the colour of that environment. */
function EnvironmentLabel({ environment }: { environment: string }) {
  const tone = environmentTone(environment);
  return (
    <Text
      fontSize="11px"
      fontWeight={500}
      paddingX={1.5}
      paddingY={0.5}
      borderRadius="sm"
      flexShrink={0}
      background={`${tone}.subtle`}
      color={`${tone}.fg`}
    >
      {environment}
    </Text>
  );
}

/** The chip that names the person or the machine a card belongs to. */
function ScopeChip({ agent }: { agent: ConnectedAgentView }) {
  const scope = scopeOf(agent);
  if (!scope) return null;
  return (
    <HStack
      gap={1}
      display="inline-flex"
      paddingX={1.5}
      paddingY={0.5}
      borderRadius="full"
      background="bg.muted"
      minWidth={0}
      flexShrink={0}
      maxWidth="50%"
    >
      {scope.kind === "owner" ? <User size={10} /> : <Laptop size={10} />}
      <Text fontSize="11px" truncate>
        {scope.label}
      </Text>
    </HStack>
  );
}

/** The actions of one card: open the agent, test it, or delete it. */
function ConnectedAgentMenu({
  agent,
  onOpen,
  onDelete,
  onTest,
}: {
  agent: ConnectedAgentView;
  onOpen: () => void;
  onDelete?: () => void;
  onTest?: () => void;
}) {
  return (
    <Menu.Root>
      <AgentCardMenuTrigger agentName={agent.name} />
      <Menu.Content>
        <Menu.Item
          value="open"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ExternalLink size={14} />
          Open
        </Menu.Item>
        {onTest && (
          <Menu.Item
            value="test"
            onClick={(event) => {
              event.stopPropagation();
              onTest();
            }}
            data-testid={`agent-test-${agent.id}`}
          >
            <Play size={14} />
            Test agent
          </Menu.Item>
        )}
        {onDelete && (
          <Menu.Item
            value="delete"
            color="red.500"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <LuTrash2 size={14} />
            Delete
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

export function ConnectedAgentCard({
  agent,
  onOpen,
  onDelete,
  onTest,
}: {
  agent: ConnectedAgentView;
  onOpen: () => void;
  onDelete?: () => void;
  onTest?: () => void;
}) {
  const sdk = sdkLabel(agent);
  const instances = instanceCountLabel(agent);
  const facts = [sdk, instances].filter((fact) => fact !== null);

  return (
    <AgentCardShell
      agentId={agent.id}
      agentName={agent.name}
      onClick={onOpen}
      testId={`connected-agent-card-${agent.id}`}
      leading={<AgentCardIcon icon={Bot} />}
      trailing={<PresenceMark agent={agent} />}
      menu={
        <ConnectedAgentMenu agent={agent} onOpen={onOpen} onDelete={onDelete} onTest={onTest} />
      }
      title={
        <HStack gap={2} width="full" minWidth={0}>
          <Text color="fg.muted" fontSize="sm" fontWeight={500} truncate>
            {agent.name}
          </Text>
          {agent.environment && <EnvironmentLabel environment={agent.environment} />}
        </HStack>
      }
      info={
        <HStack
          gap={2}
          width="full"
          minWidth={0}
          overflow="hidden"
          color="fg.subtle"
          fontSize="12px"
        >
          {facts.length > 0 && <Text truncate>{facts.join(" · ")}</Text>}
          <ScopeChip agent={agent} />
        </HStack>
      }
    />
  );
}

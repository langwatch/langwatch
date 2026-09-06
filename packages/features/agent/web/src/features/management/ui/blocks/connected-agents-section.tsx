/**
 * The connected agents of a project, as cards of the agents page (ADR-128).
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { Bot, ExternalLink, Laptop, Play, Trash2, User } from "lucide-react";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { AgentCardIcon, AgentCardMenuTrigger, AgentCardShell } from "./agent-card";
import { ownerOnlyCopy, type ConnectedAgentView } from "@langwatch/agent-contract";
import {
  environmentTone,
  instanceCountLabel,
  presenceLabel,
  scopeOf,
  sdkLabel,
  sortConnectedAgents,
} from "../../../../model/connected-agent-rows";

/**
 * The connected agents as cards.
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

/**
 * The chip that names the person or the machine a card belongs to.
 *
 * Two cards of one name and one environment are told apart by this chip
 * alone, so a card the reader cannot run carries it too and says why on
 * hover, in the words the refused run itself uses.
 */
function ScopeChip({ agent }: { agent: ConnectedAgentView }) {
  const scope = scopeOf(agent);
  if (!scope) return null;
  return (
    <Tooltip content={ownerOnlyCopy(agent.owner?.name)} disabled={agent.selectable}>
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
        data-testid="connected-agent-scope-chip"
        // The chip is the only place a card says why it cannot be run, so on
        // the cards that carry that reason it takes the tab order too: the
        // tooltip opens on focus, not on hover alone.
        tabIndex={agent.selectable ? undefined : 0}
        aria-label={agent.selectable ? undefined : ownerOnlyCopy(agent.owner?.name)}
      >
        {scope.kind === "owner" ? <User size={10} /> : <Laptop size={10} />}
        <Text fontSize="11px" truncate>
          {scope.label}
        </Text>
      </HStack>
    </Tooltip>
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
            <Trash2 size={14} />
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

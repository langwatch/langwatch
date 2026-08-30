/**
 * The connected agents of a project, as cards of the agents page (ADR-128).
 *
 * One card is one name in one environment: the process in production, the
 * one on a shared staging box, and one for every developer who runs it on
 * their laptop. The card carries the presence mark, the name with its
 * environment, the SDK that registered it, who it belongs to and what it can
 * be called with. It is the same card the HTTP and the code agents are drawn
 * in, so one page reads as one list.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, Laptop, Play, User } from "lucide-react";
import { LuTrash2 } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { AgentCardMenuTrigger, AgentCardShell } from "../AgentCard";
import {
  type ConnectedAgentView,
  environmentTone,
  instanceCountLabel,
  parameterTooltip,
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

/** The filled circle that says whether a process holds the agent. */
function PresenceMark({ agent }: { agent: ConnectedAgentView }) {
  const label = presenceLabel({
    status: agent.status,
    instanceCount: agent.instances.length,
    lastSeenAt: agent.lastSeenAt,
  });
  return (
    <Tooltip content={label}>
      <Box
        boxSize="12px"
        borderRadius="full"
        marginLeft="3px"
        aria-label={label}
        background={agent.status === "online" ? "green.500" : "fg.subtle"}
        data-testid={`connected-agent-status-${agent.status}`}
      />
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
      leading={<PresenceMark agent={agent} />}
      menu={
        <ConnectedAgentMenu
          agent={agent}
          onOpen={onOpen}
          onDelete={onDelete}
          onTest={onTest}
        />
      }
      title={
        <HStack gap={2} width="full" minWidth={0}>
          <Text color="fg.muted" fontSize="sm" fontWeight={500} truncate>
            {agent.name}
          </Text>
          {agent.environment && (
            <EnvironmentLabel environment={agent.environment} />
          )}
        </HStack>
      }
      info={
        <VStack align="stretch" gap={1} width="full" minWidth={0}>
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

          {agent.parameters.length > 0 && (
            <HStack
              gap={1.5}
              width="full"
              minWidth={0}
              overflow="hidden"
              height="18px"
            >
              {agent.parameters.map((parameter) => (
                <Tooltip
                  key={parameter.name}
                  content={parameterTooltip(parameter)}
                >
                  <Text
                    as="code"
                    fontFamily="mono"
                    fontSize="11px"
                    background="bg.muted"
                    borderRadius="sm"
                    paddingX={1.5}
                    flexShrink={0}
                  >
                    {parameter.name}
                  </Text>
                </Tooltip>
              ))}
            </HStack>
          )}
        </VStack>
      }
    />
  );
}

/**
 * One connected agent in full: what it accepts, which processes hold it, and a way to
 * call it once (ADR-128).
 * @see specs/features/agents/connected-agents-ui.feature
 */

import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow, toEpochMs } from "@langwatch/time";
import { AgentTestPanel } from "./agent-test-panel.tsx";
import type { ReactNode } from "react";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import type { ConnectedAgentBrowser } from "../../model/agent-client.ts";
import { presenceLabel, scopeOf, sdkLabel } from "../../model/connected-agent-rows.ts";

export interface ConnectedAgentDrawerProps {
  agent?: ConnectedAgentBrowser | null;
  isLoading: boolean;
  projectId: string;
  onClose(): void;
  inputs?: ReactNode;
}

export function ConnectedAgentDrawer(props: ConnectedAgentDrawerProps) {
  const agent = props.agent;
  return (
    <Drawer.Root open={true} onOpenChange={({ open }) => !open && props.onClose()}>
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <AgentTitle agent={agent} />
        </Drawer.Header>
        <Drawer.Body>
          <AgentBody
            agent={agent}
            isLoading={props.isLoading}
            projectId={props.projectId}
            inputs={props.inputs}
          />
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button colorPalette="blue" onClick={props.onClose} data-testid="connected-agent-close">
              Close
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** The agent name, with its presence line under it. */
function AgentTitle({ agent }: { agent: ConnectedAgentBrowser | null | undefined }) {
  return (
    <VStack align="start" gap={1}>
      <Heading size="md">{agent?.name ?? "Agent"}</Heading>
      {agent ? <PresenceLine agent={agent} /> : null}
    </VStack>
  );
}

/** The sections of the drawer, or the state that stands in for them. */
function AgentBody({
  agent,
  isLoading,
  projectId,
  inputs,
}: {
  agent: ConnectedAgentBrowser | null | undefined;
  isLoading: boolean;
  projectId: string;
  inputs?: ReactNode;
}) {
  if (isLoading) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner />
      </HStack>
    );
  }

  if (!agent) {
    return <Text color="fg.muted">This agent is no longer in the project.</Text>;
  }

  return (
    <VStack align="stretch" gap={6} paddingBottom={6}>
      {inputs}
      <ParametersTable agent={agent} />
      <InstancesTable agent={agent} />
      <AgentTestPanel
        agentId={agent.id}
        projectId={projectId}
        offline={agent.status === "offline"}
      />
    </VStack>
  );
}

/** The environment, the presence and who the agent belongs to, on one line. */
function PresenceLine({ agent }: { agent: ConnectedAgentBrowser }) {
  const scope = scopeOf(agent);
  const sdk = sdkLabel(agent);
  const parts = [
    agent.environment ?? "unknown",
    presenceLabel({
      status: agent.status,
      instanceCount: agent.instances.length,
      lastSeenAt: agent.lastSeenAt,
    }),
    ...(scope ? [scope.label] : []),
    ...(sdk ? [sdk] : []),
  ];
  return (
    <HStack gap={2} data-testid="connected-agent-presence">
      <Box
        boxSize="8px"
        borderRadius="full"
        background={agent.status === "online" ? "green.500" : "fg.subtle"}
      />
      <Text fontSize="sm" color="fg.muted">
        {parts.join(" · ")}
      </Text>
    </HStack>
  );
}

/** What the agent can be called with. */
function ParametersTable({ agent }: { agent: ConnectedAgentBrowser }) {
  return (
    <VStack align="stretch" gap={2} data-testid="connected-agent-parameters">
      <SectionTitle title="Parameters" />
      {agent.parameters.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          This agent declares no run parameters.
        </Text>
      ) : (
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Type</Table.ColumnHeader>
              <Table.ColumnHeader>Options</Table.ColumnHeader>
              <Table.ColumnHeader>Default</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {agent.parameters.map((parameter) => (
              <Table.Row key={parameter.name}>
                <Table.Cell fontFamily="mono">{parameter.name}</Table.Cell>
                <Table.Cell>{parameter.type ?? "string"}</Table.Cell>
                <Table.Cell>
                  {parameter.options?.length
                    ? parameter.options.map(String).join(", ")
                    : "any value"}
                </Table.Cell>
                <Table.Cell>
                  {parameter.defaultValue === undefined ? "none" : String(parameter.defaultValue)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </VStack>
  );
}

/** The processes that hold the agent right now. */
function InstancesTable({ agent }: { agent: ConnectedAgentBrowser }) {
  return (
    <VStack align="stretch" gap={2} data-testid="connected-agent-instances">
      <SectionTitle title="Instances" />
      {agent.instances.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No process is connected right now.
        </Text>
      ) : (
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Hostname</Table.ColumnHeader>
              <Table.ColumnHeader>Label</Table.ColumnHeader>
              <Table.ColumnHeader>Process id</Table.ColumnHeader>
              <Table.ColumnHeader>Connected</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {agent.instances.map((instance) => (
              <Table.Row key={instance.instanceId}>
                <Table.Cell>{instance.hostname}</Table.Cell>
                <Table.Cell>{instance.label ?? "none"}</Table.Cell>
                <Table.Cell>{instance.pid}</Table.Cell>
                <Table.Cell>
                  {formatDistanceToNow(toEpochMs(instance.connectedAt), {
                    addSuffix: true,
                  })}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </VStack>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text fontSize="sm" fontWeight="medium">
      {title}
    </Text>
  );
}

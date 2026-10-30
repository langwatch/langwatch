/**
 * One connected agent in full: what it accepts, which processes hold it, and a way to
 * call it once (ADR-128).
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { formatDistanceToNow, toEpochMs } from "@langwatch/time";
import type { ReactNode } from "react";

import type { ConnectedAgentBrowser } from "../../model/agent-client.ts";
import { presenceLabel, scopeOf, sdkLabel } from "../../model/connected-agent-rows.ts";
import { ConnectedAgentHooksHint } from "../blocks/connected-agent-hooks-hint.tsx";
import { AgentTestPanel } from "./agent-test-panel.tsx";

export interface ConnectedAgentDrawerProps {
  agent?: ConnectedAgentBrowser | null;
  isLoading: boolean;
  projectId: string;
  onClose: () => void;
  inputs?: ReactNode;
}

export function ConnectedAgentDrawer(props: ConnectedAgentDrawerProps) {
  const agent = props.agent;
  return (
    <Drawer
      onClose={props.onClose}
      title={agent?.name ?? "Agent"}
      subtitle={agent ? <PresenceLine agent={agent} /> : void 0}
      loading={props.isLoading}
      footer={{
        primaryAction: {
          label: "Close",
          onClick: props.onClose,
          "data-testid": "connected-agent-close",
        },
      }}
    >
      <AgentBody agent={agent} projectId={props.projectId} inputs={props.inputs} />
    </Drawer>
  );
}

/** The sections of the drawer, or the state that stands in for them. */
function AgentBody({
  agent,
  projectId,
  inputs,
}: {
  agent: ConnectedAgentBrowser | null | undefined;
  projectId: string;
  inputs?: ReactNode;
}) {
  if (!agent) {
    return <Text color="fg.muted">This agent is no longer in the project.</Text>;
  }

  return (
    <VStack align="stretch" gap={6} paddingBottom={6}>
      {inputs}
      <ConnectedAgentHooksHint status={agent.status} hooks={agent.config.hooks} />
      <ParametersTable agent={agent} />
      <InstancesTable agent={agent} />
      <AgentTestPanel
        agentId={agent.id}
        projectId={projectId}
        offline={agent.status === "offline"}
        parameters={agent.parameters}
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
    <HStack as="span" gap={2} data-testid="connected-agent-presence">
      <Box
        as="span"
        boxSize="8px"
        borderRadius="full"
        background={agent.status === "online" ? "green.solid" : "fg.subtle"}
      />
      <Text as="span" fontSize="sm" color="fg.muted">
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
        <ListTable density="compact" scroll="x" scrollLabel="Parameters">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Type</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Options</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Default</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {agent.parameters.map((parameter) => (
              <ListTable.Row key={parameter.name}>
                <ListTable.Cell mono>{parameter.name}</ListTable.Cell>
                <ListTable.Cell>{parameter.type ?? "string"}</ListTable.Cell>
                <ListTable.Cell>
                  {parameter.options?.length
                    ? parameter.options.map(String).join(", ")
                    : "any value"}
                </ListTable.Cell>
                <ListTable.Cell>
                  {parameter.defaultValue === undefined ? "none" : String(parameter.defaultValue)}
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
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
        <ListTable density="compact" scroll="x" scrollLabel="Instances">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Hostname</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Label</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Process id</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Connected</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {agent.instances.map((instance) => (
              <ListTable.Row key={instance.instanceId}>
                <ListTable.Cell>{instance.hostname}</ListTable.Cell>
                <ListTable.Cell>{instance.label ?? "none"}</ListTable.Cell>
                <ListTable.Cell>{instance.pid}</ListTable.Cell>
                <ListTable.Cell>
                  {formatDistanceToNow(toEpochMs(instance.connectedAt), {
                    addSuffix: true,
                  })}
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
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

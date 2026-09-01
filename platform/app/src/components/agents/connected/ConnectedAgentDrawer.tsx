/**
 * One connected agent in full: what it accepts, which processes hold it, and
 * a way to call it once (ADR-128).
 *
 * The name, the environment and the parameters come from the process that
 * registered them, so the drawer reads them and writes nothing.
 *
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
import { formatDistanceToNow } from "date-fns";
import { AgentTestPanel } from "~/components/agents/AgentTestPanel";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  type ConnectedAgentView,
  presenceLabel,
  scopeOf,
  sdkLabel,
} from "./connected-agent-rows";

export type ConnectedAgentDrawerProps = {
  agentId?: string;
};

export function ConnectedAgentDrawer(props: ConnectedAgentDrawerProps) {
  const { closeDrawer } = useDrawer();
  const drawerParams = useDrawerParams();
  const { project } = useOrganizationTeamProject();
  const agentId = props.agentId ?? drawerParams.agentId;
  const projectId = project?.id ?? "";

  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: !!agentId && !!projectId, refetchInterval: 5000 },
  );
  const agent = agentQuery.data as ConnectedAgentView | null | undefined;

  return (
    <Drawer.Root
      open={true}
      onOpenChange={({ open }) => !open && closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <AgentTitle agent={agent} />
        </Drawer.Header>
        <Drawer.Body>
          <AgentBody
            agent={agent}
            isLoading={agentQuery.isLoading}
            projectId={projectId}
          />
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              colorPalette="blue"
              onClick={closeDrawer}
              data-testid="connected-agent-close"
            >
              Close
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** The agent name, with its presence line under it. */
function AgentTitle({
  agent,
}: {
  agent: ConnectedAgentView | null | undefined;
}) {
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
}: {
  agent: ConnectedAgentView | null | undefined;
  isLoading: boolean;
  projectId: string;
}) {
  if (isLoading) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner />
      </HStack>
    );
  }

  if (!agent) {
    return (
      <Text color="fg.muted">This agent is no longer in the project.</Text>
    );
  }

  return (
    <VStack align="stretch" gap={6} paddingBottom={6}>
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
function PresenceLine({ agent }: { agent: ConnectedAgentView }) {
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
function ParametersTable({ agent }: { agent: ConnectedAgentView }) {
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
                  {parameter.defaultValue === undefined
                    ? "none"
                    : String(parameter.defaultValue)}
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
function InstancesTable({ agent }: { agent: ConnectedAgentView }) {
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
                  {formatDistanceToNow(new Date(instance.connectedAt), {
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

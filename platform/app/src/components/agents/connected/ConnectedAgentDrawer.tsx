/**
 * One connected agent in full: what it accepts, which processes hold it, how
 * to connect another one, and a way to call it once (ADR-128).
 *
 * The name, the environment and the parameters come from the process that
 * registered them, so they are read here and never edited. Only the
 * description belongs to the platform, so it is the one field the drawer
 * writes.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { CopyButton } from "~/components/CopyButton";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { pythonSnippet, typescriptSnippet } from "./connect-snippets";
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

  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id, refetchInterval: 5000 },
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
          <VStack align="start" gap={1}>
            <Heading size="md">{agent?.name ?? "Agent"}</Heading>
            {agent ? <PresenceLine agent={agent} /> : null}
          </VStack>
        </Drawer.Header>
        <Drawer.Body>
          {agentQuery.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner />
            </HStack>
          ) : agent ? (
            <VStack align="stretch" gap={6} paddingBottom={6}>
              <DescriptionField agent={agent} projectId={project?.id ?? ""} />
              <ParametersTable agent={agent} />
              <InstancesTable agent={agent} />
              <ConnectSnippet agent={agent} />
              <TestPanel agent={agent} projectId={project?.id ?? ""} />
            </VStack>
          ) : (
            <Text color="fg.muted">
              This agent is no longer in the project.
            </Text>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
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

/** The one field of a connected agent the platform owns. */
function DescriptionField({
  agent,
  projectId,
}: {
  agent: ConnectedAgentView;
  projectId: string;
}) {
  const utils = api.useUtils();
  const [description, setDescription] = useState(
    agent.config.description ?? "",
  );

  useEffect(() => {
    setDescription(agent.config.description ?? "");
  }, [agent.id, agent.config.description]);

  const update = api.agents.update.useMutation({
    onSuccess: () => {
      void utils.agents.getById.invalidate({ id: agent.id, projectId });
      void utils.agents.getAll.invalidate({ projectId });
      toaster.create({ title: "Description saved", type: "success" });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't save the description" }),
  });

  return (
    <VStack align="stretch" gap={2} data-testid="connected-agent-description">
      <SectionTitle
        title="Description"
        hint="The name, the environment and the parameters come from the code that registered this agent."
      />
      <Textarea
        value={description}
        rows={2}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="What this agent does"
      />
      <HStack>
        <Button
          size="xs"
          colorPalette="blue"
          loading={update.isPending}
          onClick={() =>
            update.mutate({
              id: agent.id,
              projectId,
              config: { description },
            })
          }
          data-testid="connected-agent-save-description"
        >
          Save
        </Button>
      </HStack>
    </VStack>
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
              <Table.ColumnHeader>Description</Table.ColumnHeader>
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
                <Table.Cell>{parameter.description ?? ""}</Table.Cell>
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

/** The code that connects another process to this same agent. */
function ConnectSnippet({ agent }: { agent: ConnectedAgentView }) {
  const language = agent.config.sdk?.language ?? "python";
  const code =
    language === "typescript" || language === "javascript"
      ? typescriptSnippet({ name: agent.name, environment: agent.environment })
      : pythonSnippet({ name: agent.name, environment: agent.environment });

  return (
    <VStack align="stretch" gap={2} data-testid="connected-agent-snippet">
      <SectionTitle title="Connect another process" />
      <HStack
        align="start"
        gap={2}
        background="bg.muted"
        borderRadius="md"
        paddingX={3}
        paddingY={2}
      >
        <Box
          as="pre"
          flex={1}
          overflowX="auto"
          fontFamily="mono"
          fontSize="12px"
          whiteSpace="pre"
        >
          {code}
        </Box>
        <CopyButton value={code} label="Snippet" />
      </HStack>
    </VStack>
  );
}

/** One turn to the agent, on the path a simulation turn takes. */
function TestPanel({
  agent,
  projectId,
}: {
  agent: ConnectedAgentView;
  projectId: string;
}) {
  const [message, setMessage] = useState("Hello");
  const test = api.agents.testConnected.useMutation();

  return (
    <VStack align="stretch" gap={2} data-testid="connected-agent-test">
      <SectionTitle title="Test" />
      <HStack>
        <Input
          size="sm"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="A message to send"
          data-testid="connected-agent-test-message"
        />
        <Button
          size="sm"
          colorPalette="blue"
          loading={test.isPending}
          disabled={agent.status === "offline" || message.trim().length === 0}
          onClick={() =>
            test.mutate({ id: agent.id, projectId, message: message.trim() })
          }
          data-testid="connected-agent-test-run"
        >
          <Play size={13} />
          Test
        </Button>
      </HStack>
      {agent.status === "offline" ? (
        <Text fontSize="12px" color="fg.muted">
          Start the process that runs this agent to test it.
        </Text>
      ) : null}
      {test.error ? (
        <HandledErrorAlert
          error={test.error}
          fallbackTitle="The test call did not go through"
        />
      ) : null}
      {test.data ? (
        <VStack
          align="stretch"
          gap={1}
          background="bg.muted"
          borderRadius="md"
          padding={3}
          data-testid="connected-agent-test-result"
        >
          <Text fontSize="11.5px" color="fg.muted">
            {`${test.data.instance.hostname}${
              test.data.instance.label ? ` (${test.data.instance.label})` : ""
            } answered in ${test.data.durationMs} ms`}
          </Text>
          <Box as="pre" fontFamily="mono" fontSize="12px" whiteSpace="pre-wrap">
            {typeof test.data.output === "string"
              ? test.data.output
              : JSON.stringify(test.data.output, null, 2)}
          </Box>
        </VStack>
      ) : null}
    </VStack>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="sm" fontWeight="medium">
        {title}
      </Text>
      {hint ? (
        <Text fontSize="11.5px" color="fg.muted">
          {hint}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * One connected agent in full: what it accepts, which processes hold it, and
 * a way to call it once (ADR-128).
 *
 * The name, the environment and the parameters come from the process that
 * registered them, so the drawer reads them and writes nothing there. The one
 * thing it does write is the user default of a parameter (issue 7948): a
 * separate, persistent layer that survives an SDK reconnect and sits between
 * the code default and the scenario default. Everything else stays read-only.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 * @see specs/agents/connected-agent-parameter-user-defaults.feature
 */

import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { AgentTestPanel } from "~/components/agents/AgentTestPanel";
import { Drawer } from "~/components/ui/drawer";
import {
  type AvailableSource,
  type FieldMapping,
  VariablesSection,
} from "~/components/variables";
import { connectedTargetFields } from "~/experiments-v3/utils/connectedAgentTarget";
import { describeError } from "~/features/errors";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import { api } from "~/utils/api";
import {
  type ConnectedAgentView,
  presenceLabel,
  scopeOf,
  sdkLabel,
} from "./connected-agent-rows";

export type ConnectedAgentDrawerProps = {
  agentId?: string;
  /**
   * The columns a workbench row can map from. Present only when the drawer is
   * opened from a workbench column, which is the one place an agent's inputs
   * are mapped to something.
   */
  availableSources?: AvailableSource[];
  /** What the column maps today. */
  inputMappings?: Record<string, FieldMapping>;
  /** Records a mapping the moment it changes; the workbench has no Save. */
  onInputMappingsChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
};

export function ConnectedAgentDrawer(props: ConnectedAgentDrawerProps) {
  const { closeDrawer } = useDrawer();
  const drawerParams = useDrawerParams();
  const complexProps = getComplexProps();
  const flowCallbacks = getFlowCallbacks("agentConnectedDetail");
  const { project } = useOrganizationTeamProject();
  const agentId = props.agentId ?? drawerParams.agentId;
  const projectId = project?.id ?? "";

  const availableSources =
    props.availableSources ??
    (complexProps.availableSources as AvailableSource[] | undefined);
  const inputMappings =
    props.inputMappings ??
    (complexProps.inputMappings as Record<string, FieldMapping> | undefined);
  const onInputMappingsChange =
    props.onInputMappingsChange ?? flowCallbacks?.onInputMappingsChange;

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
            availableSources={availableSources}
            inputMappings={inputMappings}
            onInputMappingsChange={onInputMappingsChange}
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
  availableSources,
  inputMappings,
  onInputMappingsChange,
}: {
  agent: ConnectedAgentView | null | undefined;
  isLoading: boolean;
  projectId: string;
  availableSources?: AvailableSource[];
  inputMappings?: Record<string, FieldMapping>;
  onInputMappingsChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
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
      {onInputMappingsChange ? (
        <VariablesSection
          title="Input Variables"
          variables={connectedTargetFields(agent).inputs}
          onChange={() => {
            // The list is the agent's own contract: the turn to send, and the
            // parameters the function declares. Mappable, not editable, so
            // the section stays read-only and only the mapping selector
            // answers.
          }}
          showMappings={true}
          availableSources={availableSources}
          mappings={inputMappings}
          onMappingChange={onInputMappingsChange}
          canAddRemove={false}
          readOnly={true}
        />
      ) : null}
      <ParametersTable agent={agent} projectId={projectId} />
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

/**
 * What the agent can be called with, and the one thing the drawer writes: the
 * user default of each non-secret parameter (issue 7948).
 *
 * Name, type, options and required are read-only — the process that registered
 * the agent owns them. The Default cell is editable: it shows the effective
 * default (the user default if one is set, otherwise the code default) and lets
 * the owner set or reset it. A secret parameter carries no default and takes no
 * edit control. A user default whose parameter the code no longer declares is
 * shown as a stale row the owner can clear.
 */
function ParametersTable({
  agent,
  projectId,
}: {
  agent: ConnectedAgentView;
  projectId: string;
}) {
  const userDefaults = agent.parameterDefaults ?? {};
  const declaredNames = new Set(agent.parameters.map((each) => each.name));
  const staleNames = Object.keys(userDefaults).filter(
    (name) => !declaredNames.has(name),
  );
  const hasRows = agent.parameters.length > 0 || staleNames.length > 0;

  return (
    <VStack align="stretch" gap={2} data-testid="connected-agent-parameters">
      <SectionTitle title="Parameters" />
      {!hasRows ? (
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
              <Table.ColumnHeader>Required</Table.ColumnHeader>
              <Table.ColumnHeader>Default</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {agent.parameters.map((parameter) => (
              <ParameterRow
                key={parameter.name}
                agentId={agent.id}
                projectId={projectId}
                parameter={parameter}
                userDefault={userDefaults[parameter.name]}
                hasUserDefault={Object.hasOwn(userDefaults, parameter.name)}
              />
            ))}
            {staleNames.map((name) => (
              <StaleParameterRow
                key={name}
                agentId={agent.id}
                projectId={projectId}
                name={name}
                value={userDefaults[name]}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </VStack>
  );
}

/** The default value of one parameter as text, or "none" when there is none. */
function displayValue(value: string | number | boolean | undefined): string {
  return value === undefined ? "none" : String(value);
}

/**
 * One declared parameter: its read-only shape, and an editable Default cell
 * for the user default (issue 7948).
 */
function ParameterRow({
  agentId,
  projectId,
  parameter,
  userDefault,
  hasUserDefault,
}: {
  agentId: string;
  projectId: string;
  parameter: ScenarioParameterDefinition;
  userDefault: string | number | boolean | undefined;
  hasUserDefault: boolean;
}) {
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);
  const mutation = api.agents.setParameterDefault.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.agents.getById.invalidate();
    },
    // Do not apply the value optimistically: the previously saved default keeps
    // showing until the write lands, so a rejected value never looks accepted.
    onError: (mutationError) =>
      setError(describeError({ error: mutationError })),
  });

  const type = parameter.type ?? "string";
  const isSecret = parameter.secret === true;
  const effective = hasUserDefault ? userDefault : parameter.defaultValue;

  const save = (value: string | number | boolean) => {
    setError(null);
    mutation.mutate({ projectId, id: agentId, name: parameter.name, value });
  };
  const reset = () => {
    setError(null);
    mutation.mutate({
      projectId,
      id: agentId,
      name: parameter.name,
      value: null,
    });
  };

  return (
    <Table.Row>
      <Table.Cell fontFamily="mono">{parameter.name}</Table.Cell>
      <Table.Cell>{type}</Table.Cell>
      <Table.Cell>
        {parameter.options?.length
          ? parameter.options.map(String).join(", ")
          : "any value"}
      </Table.Cell>
      <Table.Cell>{parameter.required ? "yes" : "no"}</Table.Cell>
      <Table.Cell>
        {isSecret ? (
          <Text
            fontSize="sm"
            color="fg.muted"
            data-testid={`connected-agent-parameter-secret-${parameter.name}`}
          >
            secret
          </Text>
        ) : (
          <VStack align="stretch" gap={1}>
            <DefaultEditor
              name={parameter.name}
              type={type}
              options={parameter.options}
              effective={effective}
              disabled={mutation.isPending}
              onSave={save}
              onInvalid={setError}
            />
            {hasUserDefault ? (
              <HStack gap={2}>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={reset}
                  disabled={mutation.isPending}
                  data-testid={`connected-agent-parameter-reset-${parameter.name}`}
                >
                  Reset
                </Button>
                <Text fontSize="xs" color="fg.muted">
                  code default: {displayValue(parameter.defaultValue)}
                </Text>
              </HStack>
            ) : null}
            {error ? (
              <Text
                fontSize="xs"
                color="fg.error"
                data-testid={`connected-agent-parameter-error-${parameter.name}`}
              >
                {error}
              </Text>
            ) : null}
          </VStack>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * The edit control for one parameter's default: a select for a closed option
 * list, a checkbox for a boolean, a text input otherwise. Each carries a Save
 * that hands the parsed value up; a number that will not parse is refused here
 * without a round trip.
 */
function DefaultEditor({
  name,
  type,
  options,
  effective,
  disabled,
  onSave,
  onInvalid,
}: {
  name: string;
  type: "string" | "number" | "boolean";
  options: ScenarioParameterDefinition["options"];
  effective: string | number | boolean | undefined;
  disabled: boolean;
  onSave: (value: string | number | boolean) => void;
  onInvalid: (message: string) => void;
}) {
  const [text, setText] = useState<string>(
    effective === undefined ? "" : String(effective),
  );
  const [checked, setChecked] = useState<boolean>(effective === true);
  const testId = `connected-agent-parameter-default-${name}`;

  if (type === "boolean") {
    return (
      <HStack gap={2}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => setChecked(event.target.checked)}
          data-testid={testId}
          aria-label={`Default for ${name}`}
        />
        <SaveButton
          name={name}
          disabled={disabled}
          onClick={() => onSave(checked)}
        />
      </HStack>
    );
  }

  if (options?.length) {
    return (
      <HStack gap={2}>
        <select
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          data-testid={testId}
          aria-label={`Default for ${name}`}
        >
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
        <SaveButton
          name={name}
          disabled={disabled}
          onClick={() => onSave(coerce({ type, text, options }))}
        />
      </HStack>
    );
  }

  return (
    <HStack gap={2}>
      <Input
        size="xs"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        data-testid={testId}
        aria-label={`Default for ${name}`}
      />
      <SaveButton
        name={name}
        disabled={disabled}
        onClick={() => {
          if (type === "number") {
            const parsed = Number(text);
            if (text.trim() === "" || !Number.isFinite(parsed)) {
              onInvalid("Enter a number.");
              return;
            }
            onSave(parsed);
            return;
          }
          onSave(text);
        }}
      />
    </HStack>
  );
}

/**
 * The typed value a select carries. A number-typed option list keeps numeric
 * options as numbers so the save matches the declared type.
 */
function coerce({
  type,
  text,
  options,
}: {
  type: "string" | "number" | "boolean";
  text: string;
  options: NonNullable<ScenarioParameterDefinition["options"]>;
}): string | number | boolean {
  if (type !== "number") return text;
  const match = options.find((option) => String(option) === text);
  return typeof match === "number" ? match : Number(text);
}

function SaveButton({
  name,
  disabled,
  onClick,
}: {
  name: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      colorPalette="blue"
      disabled={disabled}
      onClick={onClick}
      data-testid={`connected-agent-parameter-save-${name}`}
    >
      Save
    </Button>
  );
}

/**
 * A user default whose parameter the code no longer declares (issue 7948):
 * ignored at runtime, shown here so the owner can clear it.
 */
function StaleParameterRow({
  agentId,
  projectId,
  name,
  value,
}: {
  agentId: string;
  projectId: string;
  name: string;
  value: string | number | boolean | undefined;
}) {
  const utils = api.useUtils();
  const mutation = api.agents.setParameterDefault.useMutation({
    onSuccess: () => void utils.agents.getById.invalidate(),
  });

  return (
    <Table.Row>
      <Table.Cell fontFamily="mono">
        <HStack gap={2}>
          <Text>{name}</Text>
          <Badge
            colorPalette="orange"
            data-testid={`connected-agent-parameter-stale-${name}`}
          >
            Stale
          </Badge>
        </HStack>
      </Table.Cell>
      <Table.Cell>—</Table.Cell>
      <Table.Cell>—</Table.Cell>
      <Table.Cell>—</Table.Cell>
      <Table.Cell>
        <HStack gap={2}>
          <Text fontSize="sm">{displayValue(value)}</Text>
          <Button
            size="xs"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({ projectId, id: agentId, name, value: null })
            }
            data-testid={`connected-agent-parameter-reset-${name}`}
          >
            Clear
          </Button>
        </HStack>
      </Table.Cell>
    </Table.Row>
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

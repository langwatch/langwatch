/**
 * The connected agents of a project, grouped by the name they registered
 * under (ADR-128).
 *
 * One name is one agent to a person and several rows to the platform: the
 * process in production, the one on a shared staging box, and one for every
 * developer who runs it on their laptop. The group carries the name, and
 * each row says which environment it is, whether a process holds it right
 * now, who it belongs to, and what it can be called with.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { Laptop, MoreVertical, User } from "lucide-react";
import { LuTrash2 } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import {
  type ConnectedAgentView,
  groupConnectedAgents,
  parameterTooltip,
  presenceLabel,
  scopeOf,
  sdkLabel,
} from "./connected-agent-rows";

/** The columns of one row: presence, environment, who, SDK, parameters. */
const ROW_COLUMNS = "160px 150px 150px 1fr 32px";

export function ConnectedAgentsSection({
  agents,
  onOpen,
  onDelete,
}: {
  agents: ConnectedAgentView[];
  onOpen: (agent: ConnectedAgentView) => void;
  onDelete?: (agent: ConnectedAgentView) => void;
}) {
  const groups = groupConnectedAgents(agents);
  return (
    <VStack
      align="stretch"
      gap={4}
      width="full"
      data-testid="connected-agents-section"
    >
      {groups.map((group) => (
        <VStack
          key={group.name}
          align="stretch"
          gap={0}
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          data-testid={`connected-agent-group-${group.name}`}
        >
          <HStack
            paddingX={4}
            paddingY={2.5}
            borderBottomWidth="1px"
            borderColor="border"
            background="bg.subtle"
          >
            <Text fontWeight="medium" fontSize="sm">
              {group.name}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {group.rows.length === 1
                ? "1 environment"
                : `${group.rows.length} environments`}
            </Text>
          </HStack>
          {group.rows.map((agent) => (
            <ConnectedAgentRow
              key={agent.id}
              agent={agent}
              onOpen={() => onOpen(agent)}
              onDelete={onDelete ? () => onDelete(agent) : undefined}
            />
          ))}
        </VStack>
      ))}
    </VStack>
  );
}

function ConnectedAgentRow({
  agent,
  onOpen,
  onDelete,
}: {
  agent: ConnectedAgentView;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const scope = scopeOf(agent);
  const sdk = sdkLabel(agent);

  return (
    <Grid
      templateColumns={ROW_COLUMNS}
      gap={3}
      alignItems="center"
      paddingX={4}
      paddingY={3}
      cursor="pointer"
      _hover={{ background: "bg.muted/50" }}
      borderBottomWidth="1px"
      borderColor="border.muted"
      _last={{ borderBottomWidth: 0 }}
      onClick={onOpen}
      data-testid={`connected-agent-row-${agent.id}`}
    >
      <HStack gap={2} minWidth={0}>
        <Box
          boxSize="8px"
          borderRadius="full"
          flexShrink={0}
          background={agent.status === "online" ? "green.500" : "fg.subtle"}
          data-testid={`connected-agent-status-${agent.status}`}
        />
        <Text fontSize="12px" color="fg.muted" truncate>
          {presenceLabel({
            status: agent.status,
            instanceCount: agent.instances.length,
            lastSeenAt: agent.lastSeenAt,
          })}
        </Text>
      </HStack>

      <Text fontSize="13px" fontWeight="medium" truncate>
        {agent.environment ?? "unknown"}
      </Text>

      <Box minWidth={0}>
        {scope ? (
          <HStack
            gap={1}
            display="inline-flex"
            paddingX={2}
            paddingY={0.5}
            borderRadius="full"
            background="bg.muted"
            maxWidth="full"
          >
            {scope.kind === "owner" ? <User size={11} /> : <Laptop size={11} />}
            <Text fontSize="11px" truncate>
              {scope.label}
            </Text>
          </HStack>
        ) : null}
      </Box>

      <HStack gap={3} minWidth={0}>
        {sdk ? (
          <Text fontSize="11.5px" color="fg.muted" flexShrink={0}>
            {sdk}
          </Text>
        ) : null}
        <HStack gap={1.5} flexWrap="wrap" minWidth={0}>
          {agent.parameters.map((parameter) => (
            <Tooltip key={parameter.name} content={parameterTooltip(parameter)}>
              <Text
                as="code"
                fontFamily="mono"
                fontSize="11px"
                background="bg.muted"
                borderRadius="sm"
                paddingX={1.5}
              >
                {parameter.name}
              </Text>
            </Tooltip>
          ))}
        </HStack>
      </HStack>

      <Box textAlign="right">
        {onDelete ? (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Box
                as="button"
                aria-label={`Actions for ${agent.name}`}
                padding={1}
                borderRadius="sm"
                _hover={{ background: "bg.muted" }}
                onClick={(event: React.MouseEvent) => event.stopPropagation()}
              >
                <MoreVertical size={14} />
              </Box>
            </Menu.Trigger>
            <Menu.Content>
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
            </Menu.Content>
          </Menu.Root>
        ) : null}
      </Box>
    </Grid>
  );
}

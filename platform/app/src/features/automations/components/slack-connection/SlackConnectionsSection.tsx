import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FaSlack } from "react-icons/fa";
import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import { HandledErrorAlert } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  maskedSecret,
  slackConnectionKindLabel,
  usedByLabel,
} from "./slackConnectionCopy";
import type { SlackConnection } from "./slackConnectionTypes";

/**
 * Settings → Integrations → Slack: every connection the current project can
 * use, its own and its organization's (ADR-093 §5a). Rows and "Add Slack
 * connection" open the one connection drawer.
 */
export function SlackConnectionsSection() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const projectId = project?.id ?? "";
  const list = api.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const canAdd =
    !!list.data?.canManageProject || !!list.data?.canManageOrganization;

  return (
    <Card.Root id="slack">
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack gap={2} justify="space-between">
            <HStack gap={2}>
              <FaSlack size={18} />
              <Heading size="sm">Slack</Heading>
            </HStack>
            {canAdd ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDrawer("slackConnection", {})}
              >
                <Plus size={14} /> Add Slack connection
              </Button>
            ) : null}
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            The Slack bot tokens and incoming webhooks your automations post
            through. Each one is shared by the whole organization or kept to one
            project.
          </Text>
          {list.error ? (
            <HandledErrorAlert
              error={list.error}
              fallbackTitle="Couldn't load Slack connections"
            />
          ) : !list.data ? (
            <Skeleton height="48px" data-testid="slack-connections-loading" />
          ) : list.data.connections.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No Slack connections yet.
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {list.data.connections.map((connection) => (
                <SlackConnectionRow
                  key={connection.id}
                  connection={connection}
                  onOpen={() =>
                    openDrawer("slackConnection", {
                      connectionId: connection.id,
                    })
                  }
                />
              ))}
            </VStack>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function SlackConnectionRow({
  connection,
  onOpen,
}: {
  connection: SlackConnection;
  onOpen: () => void;
}) {
  return (
    <Box
      as="button"
      textAlign="left"
      width="full"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      cursor="pointer"
      _hover={{ bg: "bg.subtle" }}
      onClick={onOpen}
      aria-label={`Open Slack connection ${connection.name}`}
    >
      <HStack justify="space-between" gap={3} align="start">
        <VStack align="start" gap={1} minWidth={0}>
          <HStack gap={2} wrap="wrap">
            <Text fontSize="sm" fontWeight="600">
              {connection.name}
            </Text>
            <Badge variant="subtle" size="sm">
              {slackConnectionKindLabel(connection.kind)}
            </Badge>
            <ProviderScopeChips
              size="xs"
              scopes={[
                {
                  scopeType: connection.scopeType,
                  scopeId: connection.scopeId,
                  name: connection.scopeName,
                },
              ]}
            />
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {connection.slackTeamName ?? maskedSecret(connection.secretHint)}
          </Text>
        </VStack>
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
          {usedByLabel(connection.dependentAutomations)}
        </Text>
      </HStack>
    </Box>
  );
}

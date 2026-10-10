/**
 * The Slack card: every connection the current project can use, its own and its organization's.
 * Rows and "Add Slack connection" open slack's `slackConnection` drawer by name (§10).
 * Spec: modules/slack/specs/slack-connections.feature.
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { describeError } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import {
  Alert,
  Button,
  Card,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import { SettingItem, SettingList } from "@langwatch/design-system/settings-card";
import {
  maskedSecret,
  slackConnectionKindLabel,
  slackConnectionScopeLabel,
  type SlackConnection,
  usedByLabel,
} from "@langwatch/slack-contract";
import { FaSlack } from "react-icons/fa";
import { LuChevronRight, LuPlus } from "react-icons/lu";

import { slackApi } from "../../behavior/slack-api.ts";

export function SlackCard() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const projectId = project?.id ?? "";
  const list = slackApi.slackIntegration.list.useQuery({ projectId }, { enabled: !!projectId });
  const canAdd = !!list.data?.canManageProject || !!list.data?.canManageOrganization;

  const renderConnections = () => {
    if (list.error) {
      return (
        <Alert.Root status="error" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {describeError({
                error: list.error,
                fallbackTitle: "Couldn't load Slack connections",
              })}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      );
    }
    if (!list.data) return <Skeleton height="48px" data-testid="slack-connections-loading" />;
    if (list.data.connections.length === 0) {
      return (
        <Text fontSize="sm" color="fg.muted">
          No Slack connections yet.
        </Text>
      );
    }
    return (
      <SettingList>
        {list.data.connections.map((connection) => (
          <SlackConnectionRow
            key={connection.id}
            connection={connection}
            onOpen={() => openDrawer("slackConnection", { connectionId: connection.id })}
          />
        ))}
      </SettingList>
    );
  };

  return (
    <Card.Root bg="bg.card" borderColor="border.card" id="slack">
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack gap={2} justify="space-between">
            <HStack gap={2}>
              <FaSlack size={18} />
              <Heading size="sm">Slack</Heading>
            </HStack>
            {canAdd ? (
              <Button size="sm" variant="outline" onClick={() => openDrawer("slackConnection", {})}>
                <LuPlus size={14} /> Add Slack connection
              </Button>
            ) : null}
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            The Slack bot tokens and incoming webhooks your automations post through. Each one is
            shared by the whole organization or kept to one project.
          </Text>
          {renderConnections()}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** One connection; its "Used by N" is the connection's claim count, read before any delete. */
function SlackConnectionRow({
  connection,
  onOpen,
}: {
  connection: SlackConnection;
  onOpen: () => void;
}) {
  return (
    <SettingItem as="button" onClick={onOpen} aria-label={`Edit ${connection.name}`}>
      <HStack justify="space-between" gap={4} align="center">
        <VStack align="start" gap={1} minWidth={0}>
          <HStack gap={2} wrap="wrap">
            <Text fontSize="sm" fontWeight="medium">
              {connection.name}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {slackConnectionKindLabel(connection.kind)}
            </Text>
            <ProviderScopeChips
              size="sm"
              tone="neutral"
              scopes={[
                {
                  scopeType: connection.scopeType,
                  scopeId: connection.scopeId,
                  name: slackConnectionScopeLabel(connection.scopeType),
                  detail: connection.scopeName,
                },
              ]}
            />
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {connection.slackTeamName ?? maskedSecret(connection.secretHint)}
          </Text>
        </VStack>
        <HStack gap={2} flexShrink={0} color="fg.muted">
          <Text fontSize="xs" textAlign="end" maxWidth={{ base: "28", md: "none" }}>
            {usedByLabel(connection.dependentAutomations)}
          </Text>
          <LuChevronRight size={16} aria-hidden />
        </HStack>
      </HStack>
    </SettingItem>
  );
}

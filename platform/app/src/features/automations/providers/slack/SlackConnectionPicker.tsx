import {
  Box,
  createListCollection,
  Field,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import {
  slackConnectionKindLabel,
  slackConnectionScopeLabel,
} from "~/features/automations/components/slack-connection/slackConnectionCopy";
import type { SlackIntegrationKind } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { keepDraftOnSubFlowReturn } from "../../state/subFlow";
import type { SlackSlice } from "./client";

const NEW_CONNECTION = "__new_slack_connection__";

/** Points the slice at a connection. A new connection in another workspace
 *  cannot keep a channel picked for the previous one. */
export function selectConnection({
  slice,
  connectionId,
  connectionName,
  kind,
}: {
  slice: SlackSlice;
  connectionId: string;
  connectionName: string;
  kind: SlackIntegrationKind;
}): SlackSlice {
  const switchesConnection =
    !!slice.slackIntegrationId && slice.slackIntegrationId !== connectionId;
  return {
    ...slice,
    slackIntegrationId: connectionId,
    connectionName,
    deliveryMethod: kind === "BOT" ? "bot" : "webhook",
    channelId: switchesConnection ? "" : slice.channelId,
    legacyParams: null,
  };
}

/**
 * The Slack step's connection choice (ADR-093 §5a). "New Slack connection"
 * goes to the connection drawer and comes back with it selected.
 */
export function SlackConnectionPicker({
  projectId,
  slice,
  onChange,
}: {
  projectId: string;
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
}) {
  const connections = api.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const openConnectionCreation = useConnectionCreation({
    slice,
    onChange,
    refetch: connections.refetch,
  });
  const data = connections.data;
  const canCreate = !!data?.canManageProject || !!data?.canManageOrganization;
  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          ...(data?.connections ?? []).map((connection) => ({
            value: connection.id,
            label: connection.name,
            detail: `${slackConnectionKindLabel(connection.kind)} · ${slackConnectionScopeLabel(connection.scopeType)}`,
          })),
          ...(canCreate
            ? [
                {
                  value: NEW_CONNECTION,
                  label: "New Slack connection",
                  detail: "",
                },
              ]
            : []),
        ],
      }),
    [data?.connections, canCreate],
  );

  if (!data) {
    return <Skeleton height="40px" data-testid="slack-state-loading" />;
  }

  const pick = (value: string | undefined) => {
    if (value === NEW_CONNECTION) {
      openConnectionCreation();
      return;
    }
    const connection = data.connections.find((c) => c.id === value);
    if (!connection) return;
    onChange(
      selectConnection({
        slice,
        connectionId: connection.id,
        connectionName: connection.name,
        kind: connection.kind,
      }),
    );
  };

  return (
    <VStack align="stretch" gap={3}>
      {!slice.slackIntegrationId && slice.legacyParams ? (
        <LegacySecretNotice />
      ) : null}
      <Field.Root>
        <HStack justify="space-between" width="full">
          <Field.Label>Slack connection</Field.Label>
          <Link href="/settings/integrations" textStyle="xs">
            Manage Slack connections
          </Link>
        </HStack>
        <Select.Root
          collection={collection}
          value={slice.slackIntegrationId ? [slice.slackIntegrationId] : []}
          onValueChange={({ value }) => pick(value[0])}
        >
          <Select.Trigger>
            <Select.ValueText placeholder="Pick a connection" />
          </Select.Trigger>
          <Select.Content>
            {collection.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.value === NEW_CONNECTION ? (
                  <HStack gap={2}>
                    <Plus size={14} />
                    <Text>{item.label}</Text>
                  </HStack>
                ) : (
                  <VStack align="start" gap={0}>
                    <Text>{item.label}</Text>
                    <Text textStyle="xs" color="fg.muted">
                      {item.detail}
                    </Text>
                  </VStack>
                )}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Field.HelperText>
          {connectionHelp({
            slice,
            hasConnections: data.connections.length > 0,
            canCreate,
          })}
        </Field.HelperText>
      </Field.Root>
    </VStack>
  );
}

/**
 * Hands over to the connection drawer and returns with `goBack`, exactly as
 * dataset creation does: the draft lives in the singleton store, `onClose`
 * runs on both endings, and walking away puts the previous choice back.
 */
function useConnectionCreation({
  slice,
  onChange,
  refetch,
}: {
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
  refetch: () => unknown;
}) {
  const { openDrawer, goBack } = useDrawer();
  return function openConnectionCreation() {
    const previousConnectionId = slice.slackIntegrationId;
    let hasCreatedConnection = false;

    openDrawer("slackConnection", {
      onSuccess: ({ connectionId, name, kind }) => {
        hasCreatedConnection = true;
        void refetch();
        onChange(
          selectConnection({
            slice,
            connectionId,
            connectionName: name,
            kind,
          }),
        );
      },
      onClose: () => {
        if (!hasCreatedConnection && previousConnectionId) {
          onChange({ ...slice, slackIntegrationId: previousConnectionId });
        }
        // The drawer opens blank unless the return says otherwise.
        keepDraftOnSubFlowReturn();
        goBack();
      },
    });
  };
}

function connectionHelp({
  slice,
  hasConnections,
  canCreate,
}: {
  slice: SlackSlice;
  hasConnections: boolean;
  canCreate: boolean;
}): string {
  if (!hasConnections) {
    return canCreate
      ? "No Slack connections yet. Add one to post to Slack."
      : "No Slack connections yet. Ask an admin to add one in the integration settings.";
  }
  if (!slice.slackIntegrationId) return "Pick where this automation posts.";
  return slice.deliveryMethod === "bot"
    ? "Posts to the channel you pick, with charts, tables and status banners."
    : "Posts to the channel the webhook was created for. Charts and tables are sent as text.";
}

function LegacySecretNotice() {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
      data-testid="slack-legacy-secret"
    >
      <Text textStyle="xs" fontWeight="medium" color="fg">
        Uses a Slack secret stored on this automation
      </Text>
      <Text textStyle="xs" color="fg.muted">
        Pick a connection to deliver through instead. Until you do, it keeps
        posting as it does now.
      </Text>
    </Box>
  );
}

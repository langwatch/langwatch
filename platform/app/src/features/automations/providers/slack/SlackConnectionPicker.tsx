import {
  Box,
  Field,
  HStack,
  type ListCollection,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import type { SlackIntegrationKind } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { keepDraftOnSubFlowReturn } from "../../state/subFlow";
import type { SlackSlice } from "./client";
import {
  NEW_CONNECTION,
  type SlackConnectionListItem,
  useSlackConnectionCollection,
} from "./useSlackConnectionCollection";

interface ConnectionOption {
  value: string;
  label: string;
  detail: string;
}

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
  const isSwitchingConnection =
    !!slice.slackIntegrationId && slice.slackIntegrationId !== connectionId;
  return {
    ...slice,
    slackIntegrationId: connectionId,
    connectionName,
    deliveryMethod: kind === "BOT" ? "bot" : "webhook",
    channelId: isSwitchingConnection ? "" : slice.channelId,
    legacyParams: null,
  };
}

interface SlackConnectionPickerProps {
  projectId: string;
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
}

/**
 * The Slack step's connection choice (ADR-093 §5a). "New Slack connection"
 * goes to the connection drawer and comes back with it selected.
 */
export function SlackConnectionPicker({
  projectId,
  slice,
  onChange,
}: SlackConnectionPickerProps) {
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
  const collection = useSlackConnectionCollection({
    connections: data?.connections,
    canCreate,
  });

  if (!data) {
    return <Skeleton height="40px" data-testid="slack-state-loading" />;
  }

  const pick = (value: string | undefined) => {
    if (value === NEW_CONNECTION) openConnectionCreation();
    else
      pickSavedConnection({
        value,
        connections: data.connections,
        slice,
        onChange,
      });
  };

  return (
    <VStack align="stretch" gap={3}>
      {!slice.slackIntegrationId && slice.legacyParams ? (
        <LegacySecretNotice />
      ) : null}
      <Field.Root>
        <ConnectionFieldLabel />
        <SlackConnectionSelect
          collection={collection}
          selectedId={slice.slackIntegrationId}
          onPick={pick}
        />
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

function pickSavedConnection({
  value,
  connections,
  slice,
  onChange,
}: {
  value: string | undefined;
  connections: SlackConnectionListItem[];
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
}) {
  const connection = connections.find((c) => c.id === value);
  if (!connection) return;
  onChange(
    selectConnection({
      slice,
      connectionId: connection.id,
      connectionName: connection.name,
      kind: connection.kind,
    }),
  );
}

function ConnectionFieldLabel() {
  return (
    <HStack justify="space-between" width="full">
      <Field.Label>Slack connection</Field.Label>
      <Link href="/settings/integrations" textStyle="xs">
        Manage Slack connections
      </Link>
    </HStack>
  );
}

/** The connection dropdown; "New Slack connection" carries a plus. */
function SlackConnectionSelect({
  collection,
  selectedId,
  onPick,
}: {
  collection: ListCollection<ConnectionOption>;
  selectedId: string;
  onPick: (value: string | undefined) => void;
}) {
  return (
    <Select.Root
      collection={collection}
      value={selectedId ? [selectedId] : []}
      onValueChange={({ value }) => onPick(value[0])}
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

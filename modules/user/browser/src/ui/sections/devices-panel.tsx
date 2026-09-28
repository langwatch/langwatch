import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type {
  CliSessionCard,
  PersonalIngestionKeyListing,
} from "@langwatch/enterprise-governance-contract";
import { type ReactNode, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import {
  usePersonalToaster,
  useShowErrorToast,
} from "../../behavior/personal-workspace-feedback.ts";
import { usePersonalContext } from "../../behavior/use-personal-context.ts";
import { type GroupedIngestionKeys, groupKeysBySession } from "../../model/credential-grouping.ts";
import { DeviceCard, IngestionKeyRow, OtherKeysCard } from "../blocks/credential-cards.tsx";
import { InstallCliCard } from "../blocks/install-cli-card.tsx";
import { WebSessionsPanel } from "./web-sessions-panel.tsx";

/**
 * Where this person is signed in, what each CLI sign-in exports with, and the
 * way to take either away. Keys a session minted sit on its card, the rest
 * under "Other keys". Spec: specs/ai-gateway/governance/sessions-and-devices.feature.
 */
export function DevicesPanel() {
  // `organizationId` is a placeholder while loading; `ready` is what gates.
  const { organizationId, ready } = usePersonalContext();
  const [pendingRevokeId, setPendingRevokeId] = useState<number | null>(null);
  const [pendingRevokeKeyId, setPendingRevokeKeyId] = useState<string | null>(null);
  const [isPendingRevokeAll, setIsPendingRevokeAll] = useState(false);

  const sessionsQuery = api.personalSessions.list.useQuery({ organizationId }, { enabled: ready });
  const keysQuery = api.ingestionKey.list.useQuery({ organizationId }, { enabled: ready });
  const revocation = useCredentialRevocation({
    organizationId,
    isReady: ready,
    onDeviceRevoked: () => setPendingRevokeId(null),
    onEveryDeviceRevoked: () => setIsPendingRevokeAll(false),
    onKeyRevoked: () => setPendingRevokeKeyId(null),
  });

  // Both lists gate the empty state: a key minted from the tile is still something to see.
  const sessions = sessionsQuery.data ?? [];
  const grouped = groupKeysBySession({ sessions, keys: keysQuery.data ?? [] });

  const renderKeyRow = (key: PersonalIngestionKeyListing) => (
    <IngestionKeyRow
      key={key.apiKeyId}
      ingestionKey={key}
      isPendingRevoke={pendingRevokeKeyId === key.apiKeyId}
      isRevoking={revocation.isRevokingKey && pendingRevokeKeyId === key.apiKeyId}
      onRequestRevoke={() => setPendingRevokeKeyId(key.apiKeyId)}
      onCancelRevoke={() => setPendingRevokeKeyId(null)}
      onConfirmRevoke={() => revocation.revokeKey(key.apiKeyId)}
    />
  );

  const isLoading = !ready || sessionsQuery.isLoading || keysQuery.isLoading;
  const hasFailed = sessionsQuery.isError || keysQuery.isError;
  const isEmpty = sessions.length === 0 && grouped.orphanKeys.length === 0;

  return (
    <VStack align="stretch" gap={4}>
      <WebSessionsPanel />

      {isPendingRevokeAll && (
        <RevokeAllConfirmation
          isRevoking={revocation.isRevokingEveryDevice}
          onCancel={() => setIsPendingRevokeAll(false)}
          onConfirm={revocation.revokeEveryDevice}
        />
      )}
      {!isPendingRevokeAll && sessions.length > 1 && (
        <HStack justify="end">
          <Button
            size="sm"
            variant="outline"
            colorPalette="red"
            onClick={() => setIsPendingRevokeAll(true)}
          >
            Revoke all
          </Button>
        </HStack>
      )}

      {isLoading && (
        <Text fontSize="sm" color="fg.muted" paddingY={8}>
          Loading devices…
        </Text>
      )}
      {!isLoading && hasFailed && (
        <CredentialsUnavailable
          onRetry={() => {
            void sessionsQuery.refetch();
            void keysQuery.refetch();
          }}
        />
      )}
      {!isLoading && !hasFailed && isEmpty && <NoDevicesState />}
      {!isLoading && !hasFailed && !isEmpty && (
        <CredentialCards
          sessions={sessions}
          grouped={grouped}
          pendingRevokeId={pendingRevokeId}
          isRevokingDevice={revocation.isRevokingDevice}
          onRequestRevoke={setPendingRevokeId}
          onCancelRevoke={() => setPendingRevokeId(null)}
          onConfirmRevoke={revocation.revokeDevice}
          renderKeyRow={renderKeyRow}
        />
      )}
    </VStack>
  );
}

/** One card per signed-in device holding the keys it minted, then the keys no session is behind. */
function CredentialCards({
  sessions,
  grouped,
  pendingRevokeId,
  isRevokingDevice,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  renderKeyRow,
}: {
  sessions: CliSessionCard[];
  grouped: GroupedIngestionKeys;
  pendingRevokeId: number | null;
  isRevokingDevice: boolean;
  onRequestRevoke: (sessionStartedAtMs: number) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: (sessionStartedAtMs: number) => void;
  renderKeyRow: (key: PersonalIngestionKeyListing) => ReactNode;
}) {
  return (
    <VStack align="stretch" gap={2}>
      {sessions.map((session) => (
        <DeviceCard
          key={session.sessionStartedAtMs}
          session={session}
          isPendingRevoke={pendingRevokeId === session.sessionStartedAtMs}
          isRevoking={isRevokingDevice && pendingRevokeId === session.sessionStartedAtMs}
          onRequestRevoke={() => onRequestRevoke(session.sessionStartedAtMs)}
          onCancelRevoke={onCancelRevoke}
          onConfirmRevoke={() => onConfirmRevoke(session.sessionStartedAtMs)}
        >
          {(grouped.keysBySession.get(session.sessionStartedAtMs) ?? []).map(renderKeyRow)}
        </DeviceCard>
      ))}
      {grouped.orphanKeys.length > 0 && (
        <OtherKeysCard>{grouped.orphanKeys.map(renderKeyRow)}</OtherKeysCard>
      )}
    </VStack>
  );
}

/**
 * Taking one device's access away, every device's, or one key's. A device
 * revoke retires the keys it minted, so both lists are asked again after each,
 * and the person is told how much stopped working.
 */
function useCredentialRevocation({
  organizationId,
  isReady,
  onDeviceRevoked,
  onEveryDeviceRevoked,
  onKeyRevoked,
}: {
  organizationId: string;
  isReady: boolean;
  onDeviceRevoked: () => void;
  onEveryDeviceRevoked: () => void;
  onKeyRevoked: () => void;
}) {
  const toaster = usePersonalToaster();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const refreshLists = () => {
    void utils.personalSessions.list.invalidate({ organizationId });
    void utils.ingestionKey.list.invalidate({ organizationId });
  };

  const revokeMutation = api.personalSessions.revoke.useMutation({
    onSuccess: (result) => {
      refreshLists();
      onDeviceRevoked();
      toaster.create({
        title: "Device revoked",
        description: `Cleared ${tokenCount(result.revokedTokens)} and ${keyCount(result.revokedKeys)}. The CLI on that device will fail on its next request.`,
        type: "success",
      });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't revoke the device" }),
  });

  const revokeAllMutation = api.personalSessions.revokeAll.useMutation({
    onSuccess: (result) => {
      refreshLists();
      onEveryDeviceRevoked();
      toaster.create({
        title: "All devices revoked",
        description: `Cleared ${tokenCount(result.revokedTokens)} and ${keyCount(result.revokedKeys)} across every device. You'll need to re-run \`langwatch login\` on each.`,
        type: "success",
      });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't revoke the devices" }),
  });

  const revokeKeyMutation = api.ingestionKey.revoke.useMutation({
    onSuccess: () => {
      refreshLists();
      onKeyRevoked();
      toaster.create({
        title: "Ingestion key revoked",
        description: "Anything still exporting with that token is refused from now on.",
        type: "success",
      });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't revoke the key" }),
  });

  return {
    isRevokingDevice: revokeMutation.isPending,
    isRevokingEveryDevice: revokeAllMutation.isPending,
    isRevokingKey: revokeKeyMutation.isPending,
    revokeDevice: (sessionStartedAtMs: number) => {
      if (!isReady) return;
      revokeMutation.mutate({ organizationId, sessionStartedAtMs });
    },
    revokeEveryDevice: () => {
      if (!isReady) return;
      revokeAllMutation.mutate({ organizationId });
    },
    revokeKey: (apiKeyId: string) => {
      if (!isReady) return;
      revokeKeyMutation.mutate({ organizationId, apiKeyId });
    },
  };
}

const tokenCount = (count: number): string => `${count} token${count === 1 ? "" : "s"}`;

const keyCount = (count: number): string => `${count} key${count === 1 ? "" : "s"}`;

/**
 * Taking every device's access away at once, the account-takeover recovery
 * move. It is asked for twice because it signs the person out everywhere.
 */
function RevokeAllConfirmation({
  isRevoking,
  onCancel,
  onConfirm,
}: {
  isRevoking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <HStack
      gap={2}
      paddingY={2}
      paddingX={3}
      backgroundColor="red.subtle"
      borderRadius="sm"
      borderWidth="1px"
      borderColor="red.emphasized"
    >
      <Text fontSize="xs" color="red.fg" flex={1}>
        Revoke every device on your account? Their ingestion keys stop with them, and you'll need to
        re-run <code>langwatch login</code> on each device after this.
      </Text>
      <Button size="xs" variant="ghost" onClick={onCancel} disabled={isRevoking}>
        Cancel
      </Button>
      <Button size="xs" colorPalette="red" onClick={onConfirm} loading={isRevoking}>
        Confirm revoke all
      </Button>
    </HStack>
  );
}

/** A failed read is not an empty one: a key that could not be read is still live. */
function CredentialsUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={6}>
      <VStack align="start" gap={2}>
        <Text fontSize="sm" fontWeight="medium">
          Could not load your devices and keys
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Anything already signed in keeps working. Try again to see the current list.
        </Text>
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </VStack>
    </Box>
  );
}

/** Nothing is signed in yet, so the way to sign something in comes with it. */
function NoDevicesState() {
  return (
    <VStack align="stretch" gap={4}>
      <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={6}>
        <VStack align="start" gap={2}>
          <Text fontSize="sm" fontWeight="medium">
            No devices signed in
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Sign in from a new device to see it appear here.
          </Text>
        </VStack>
      </Box>
      <InstallCliCard
        heading="Sign in from a new device"
        subline="Install the CLI on the device you want to authorize, then run `langwatch login` to start the SSO flow. The device will appear above."
      />
    </VStack>
  );
}

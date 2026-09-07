import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { KeyRound, Laptop, Monitor, Server, Smartphone } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

import { InstallCliCard } from "./InstallCliCard";
import { formatRelativeTime } from "./relativeTime";
import { usePersonalContext } from "./usePersonalContext";

/**
 * Where the CLI is signed in, what each of those sign-ins is exporting with,
 * and the way to take either away.
 *
 * Lives beside the personal virtual keys on the configure page: a key and a
 * signed-in device are the two things that can talk to LangWatch as this
 * person, so revoking one is the same errand as revoking the other and they
 * belong within a tab of each other rather than a navigation apart.
 *
 * An ingestion key minted by the CLI carries the id of the login key its
 * session owns, which is what puts it on that session's card. A key minted
 * from the tile or by an agent has no session behind it and sits under
 * "Other keys" instead, so no live credential is invisible from this page.
 *
 * Spec: specs/ai-gateway/governance/sessions-and-devices.feature.
 */
export function DevicesPanel() {
  // `organizationId` falls back to a placeholder while the organization is
  // still loading, so it is never falsy and cannot gate anything. `ready` is
  // what actually says the session and organization have arrived; without it
  // the list query fires against the placeholder and its empty result renders
  // as "No devices signed in", which tells the reader nothing is signed in
  // when the truth is that nothing is known yet.
  const { organizationId, ready } = usePersonalContext();
  const [pendingRevokeId, setPendingRevokeId] = useState<number | null>(null);
  const [pendingRevokeKeyId, setPendingRevokeKeyId] = useState<string | null>(
    null,
  );
  const [isPendingRevokeAll, setIsPendingRevokeAll] = useState(false);

  const sessionsQuery = api.personalSessions.list.useQuery(
    { organizationId },
    { enabled: ready },
  );
  const keysQuery = api.ingestionKey.list.useQuery(
    { organizationId },
    { enabled: ready },
  );
  const revocation = useCredentialRevocation({
    organizationId,
    isReady: ready,
    onDeviceRevoked: () => setPendingRevokeId(null),
    onEveryDeviceRevoked: () => setIsPendingRevokeAll(false),
    onKeyRevoked: () => setPendingRevokeKeyId(null),
  });

  const sessions = sessionsQuery.data ?? [];
  const { keysBySession, orphanKeys } = groupKeysBySession({
    sessions,
    keys: keysQuery.data ?? [],
  });

  const renderKeyRow = (key: IngestionKeyView) => (
    <IngestionKeyRow
      key={key.apiKeyId}
      ingestionKey={key}
      isPendingRevoke={pendingRevokeKeyId === key.apiKeyId}
      isRevoking={
        revocation.isRevokingKey && pendingRevokeKeyId === key.apiKeyId
      }
      onRequestRevoke={() => setPendingRevokeKeyId(key.apiKeyId)}
      onCancelRevoke={() => setPendingRevokeKeyId(null)}
      onConfirmRevoke={() => revocation.revokeKey(key.apiKeyId)}
    />
  );

  return (
    <VStack align="stretch" gap={4}>
      <RevokeAllControl
        isOffered={sessions.length > 1}
        isPending={isPendingRevokeAll}
        isRevoking={revocation.isRevokingEveryDevice}
        onRequest={() => setIsPendingRevokeAll(true)}
        onCancel={() => setIsPendingRevokeAll(false)}
        onConfirm={revocation.revokeEveryDevice}
      />

      {!ready || sessionsQuery.isLoading ? (
        <Text fontSize="sm" color="fg.muted" paddingY={8}>
          Loading devices…
        </Text>
      ) : sessions.length === 0 && orphanKeys.length === 0 ? (
        <NoDevicesState />
      ) : (
        <CredentialCards
          sessions={sessions}
          keysBySession={keysBySession}
          orphanKeys={orphanKeys}
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

/**
 * The one button that takes every device's access away, and the question it
 * asks first. Offered only when there is more than one device to revoke: with
 * a single session it is the same errand as that session's own revoke.
 */
function RevokeAllControl({
  isOffered,
  isPending,
  isRevoking,
  onRequest,
  onCancel,
  onConfirm,
}: {
  isOffered: boolean;
  isPending: boolean;
  isRevoking: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (isPending) {
    return (
      <RevokeAllConfirmation
        isRevoking={isRevoking}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  if (!isOffered) return null;
  return (
    <HStack justify="end">
      <Button
        size="sm"
        variant="outline"
        colorPalette="red"
        onClick={onRequest}
      >
        Revoke all
      </Button>
    </HStack>
  );
}

/** One signed-in device, as `personalSessions.list` reports it. */
type DeviceSessionView = ComponentProps<typeof DeviceRow>["session"];

/**
 * One card per signed-in device, each holding the keys that session minted,
 * followed by the keys no session is behind.
 */
function CredentialCards({
  sessions,
  keysBySession,
  orphanKeys,
  pendingRevokeId,
  isRevokingDevice,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  renderKeyRow,
}: {
  sessions: DeviceSessionView[];
  keysBySession: Map<number, IngestionKeyView[]>;
  orphanKeys: IngestionKeyView[];
  pendingRevokeId: number | null;
  isRevokingDevice: boolean;
  onRequestRevoke: (sessionStartedAtMs: number) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: (sessionStartedAtMs: number) => void;
  renderKeyRow: (key: IngestionKeyView) => ReactNode;
}) {
  return (
    <VStack align="stretch" gap={2}>
      {sessions.map((session) => (
        <DeviceRow
          key={session.sessionStartedAtMs}
          session={session}
          isPendingRevoke={pendingRevokeId === session.sessionStartedAtMs}
          isRevoking={
            isRevokingDevice && pendingRevokeId === session.sessionStartedAtMs
          }
          onRequestRevoke={() => onRequestRevoke(session.sessionStartedAtMs)}
          onCancelRevoke={onCancelRevoke}
          onConfirmRevoke={() => onConfirmRevoke(session.sessionStartedAtMs)}
        >
          {(keysBySession.get(session.sessionStartedAtMs) ?? []).map(
            renderKeyRow,
          )}
        </DeviceRow>
      ))}

      {orphanKeys.length > 0 && (
        <CredentialCard
          icon={<KeyRound size={20} />}
          title="Other keys"
          subline="Ingestion keys that no signed-in device is behind, minted from this page or by an agent."
        >
          {orphanKeys.map(renderKeyRow)}
        </CredentialCard>
      )}
    </VStack>
  );
}

/** One ingestion key, as the panel reads it off `ingestionKey.list`. */
export interface IngestionKeyView {
  apiKeyId: string;
  sourceType: string;
  deviceLabel: string | null;
  parentApiKeyId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}

interface SessionView {
  sessionStartedAtMs: number;
  cliApiKeyId: string | null;
}

/**
 * Which card each key belongs on.
 *
 * A key names the login key of the session that minted it, and a session
 * names the same id, so the two meet in memory over the handful of
 * credentials one person holds. A key whose parent is not among the listed
 * sessions has no device to sit under, whether it never had one or its
 * session has since gone, and falls to the "Other keys" card rather than
 * disappearing.
 */
export function groupKeysBySession({
  sessions,
  keys,
}: {
  sessions: SessionView[];
  keys: IngestionKeyView[];
}): {
  keysBySession: Map<number, IngestionKeyView[]>;
  orphanKeys: IngestionKeyView[];
} {
  const sessionByLoginKeyId = new Map(
    sessions
      .filter((session) => session.cliApiKeyId !== null)
      .map((session) => [session.cliApiKeyId!, session.sessionStartedAtMs]),
  );

  const keysBySession = new Map<number, IngestionKeyView[]>();
  const orphanKeys: IngestionKeyView[] = [];

  for (const key of keys) {
    const sessionStartedAtMs = key.parentApiKeyId
      ? sessionByLoginKeyId.get(key.parentApiKeyId)
      : void 0;
    if (sessionStartedAtMs === void 0) {
      orphanKeys.push(key);
      continue;
    }
    const bucket = keysBySession.get(sessionStartedAtMs) ?? [];
    bucket.push(key);
    keysBySession.set(sessionStartedAtMs, bucket);
  }

  return { keysBySession, orphanKeys };
}

/**
 * Taking one device's access away, every device's, or one key's. All three
 * land the same way: the credential stops, both lists are asked again, and
 * the person is told how much stopped working.
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
  const utils = api.useUtils();
  // A device revoke retires the keys that device minted, so the key list is
  // as stale as the session list after every one of these.
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
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't revoke the device" }),
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
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't revoke the devices" }),
  });

  const revokeKeyMutation = api.ingestionKey.revoke.useMutation({
    onSuccess: () => {
      refreshLists();
      onKeyRevoked();
      toaster.create({
        title: "Ingestion key revoked",
        description:
          "Anything still exporting with that token is refused from now on.",
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't revoke the key" }),
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

const tokenCount = (count: number): string =>
  `${count} token${count === 1 ? "" : "s"}`;

const keyCount = (count: number): string =>
  `${count} key${count === 1 ? "" : "s"}`;

/**
 * Taking every device's access away at once, the account-takeover recovery
 * move. It is asked for twice because it signs the person out everywhere,
 * including wherever they are reading this.
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
        Revoke every device on your account? Their ingestion keys stop with
        them, and you'll need to re-run <code>langwatch login</code> on each
        device after this.
      </Text>
      <Button
        size="xs"
        variant="ghost"
        onClick={onCancel}
        disabled={isRevoking}
      >
        Cancel
      </Button>
      <Button
        size="xs"
        colorPalette="red"
        onClick={onConfirm}
        loading={isRevoking}
      >
        Confirm revoke all
      </Button>
    </HStack>
  );
}

/** Nothing is signed in yet, so the way to sign something in comes with it. */
function NoDevicesState() {
  return (
    <VStack align="stretch" gap={4}>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={6}
      >
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

/**
 * The shell every credential on this page is drawn in: an icon, what the
 * thing is, when it was last used, the way to revoke it, and the rows of
 * whatever it owns. A CLI session and the group of session-less keys are
 * both this shape, so they share it rather than drifting apart.
 */
function CredentialCard({
  icon,
  title,
  badge,
  subline,
  meta,
  action,
  confirmation,
  isPendingRevoke = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  subline?: string | null;
  meta?: ReactNode;
  action?: ReactNode;
  confirmation?: ReactNode;
  isPendingRevoke?: boolean;
  children?: ReactNode;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor={isPendingRevoke ? "red.emphasized" : "border.muted"}
      borderRadius="sm"
      padding={3}
      data-credential-card={title}
    >
      <HStack gap={3}>
        <Box>{icon}</Box>
        <VStack align="start" gap={0} flex={1}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="medium">
              {title}
            </Text>
            {badge}
          </HStack>
          {subline && (
            <Text fontSize="xs" color="fg.muted">
              {subline}
            </Text>
          )}
          {meta}
        </VStack>
        {action}
      </HStack>
      {confirmation}
      {children}
    </VStack>
  );
}

/** The red strip that asks a second time before a credential stops working. */
function RevokeConfirmation({
  question,
  isRevoking,
  onCancel,
  onConfirm,
}: {
  question: string;
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
    >
      <Text fontSize="xs" color="red.fg" flex={1}>
        {question}
      </Text>
      <Button
        size="xs"
        variant="ghost"
        onClick={onCancel}
        disabled={isRevoking}
      >
        Cancel
      </Button>
      <Button
        size="xs"
        colorPalette="red"
        onClick={onConfirm}
        loading={isRevoking}
      >
        Confirm revoke
      </Button>
    </HStack>
  );
}

function DeviceRow({
  session,
  isPendingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  children,
}: {
  session: {
    sessionStartedAtMs: number;
    deviceLabel: string;
    hostname: string | null;
    uname: string | null;
    platform: string | null;
    lastSeenMs: number;
    expiresAtMs: number;
  };
  isPendingRevoke: boolean;
  isRevoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  children?: ReactNode;
}) {
  const Icon = platformIcon(session.platform);
  const sub = [session.hostname, session.uname].filter(Boolean).join(" · ");

  return (
    <CredentialCard
      icon={<Icon size={20} />}
      title={session.deviceLabel}
      badge={
        session.platform ? (
          <Badge variant="surface" size="sm" colorPalette="gray">
            {session.platform}
          </Badge>
        ) : null
      }
      subline={sub || null}
      meta={
        <Text fontSize="xs" color="fg.muted">
          Last used {formatRelativeTime(session.lastSeenMs)} · Expires{" "}
          {fmtAbsolute(session.expiresAtMs)}
        </Text>
      }
      isPendingRevoke={isPendingRevoke}
      action={
        !isPendingRevoke ? (
          <Button
            size="sm"
            variant="outline"
            colorPalette="red"
            onClick={onRequestRevoke}
          >
            Revoke
          </Button>
        ) : null
      }
      confirmation={
        isPendingRevoke ? (
          <RevokeConfirmation
            question={`Revoke this device? The CLI on ${session.hostname ?? "this device"} will start failing immediately, and the ingestion keys it minted stop with it.`}
            isRevoking={isRevoking}
            onCancel={onCancelRevoke}
            onConfirm={onConfirmRevoke}
          />
        ) : null
      }
    >
      {children}
    </CredentialCard>
  );
}

/**
 * One ingestion key, on the card of whatever it belongs to. It reads as a
 * row rather than a card of its own because a key is something a device
 * holds, not a second device.
 */
function IngestionKeyRow({
  ingestionKey,
  isPendingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  ingestionKey: IngestionKeyView;
  isPendingRevoke: boolean;
  isRevoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={2}
      data-ingestion-key={ingestionKey.sourceType}
    >
      <HStack gap={3}>
        <Box color="fg.muted">
          <KeyRound size={14} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm">Ingestion key · {ingestionKey.sourceType}</Text>
          <Text fontSize="xs" color="fg.muted">
            Last used {formatRelativeTime(ingestionKey.lastUsedAtMs)} · First
            issued {fmtDate(ingestionKey.createdAtMs)}
            {ingestionKey.deviceLabel ? ` · ${ingestionKey.deviceLabel}` : ""}
          </Text>
        </VStack>
        {!isPendingRevoke && (
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            aria-label={`Revoke the ${ingestionKey.sourceType} ingestion key`}
            onClick={onRequestRevoke}
          >
            Revoke
          </Button>
        )}
      </HStack>
      {isPendingRevoke && (
        <RevokeConfirmation
          question={`Revoke this ingestion key? Anything exporting ${ingestionKey.sourceType} traces with it stops immediately.`}
          isRevoking={isRevoking}
          onCancel={onCancelRevoke}
          onConfirm={onConfirmRevoke}
        />
      )}
    </VStack>
  );
}

const fmtAbsolute = (ms: number | null | undefined): string =>
  !ms ? "—" : new Date(ms).toLocaleString();

const fmtDate = (ms: number | null | undefined): string =>
  !ms
    ? "—"
    : new Date(ms).toLocaleDateString(void 0, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

const platformIcon = (platform: string | null) => {
  if (!platform) return Server;
  const p = platform.toLowerCase();
  if (p.includes("darwin") || p.includes("mac")) return Laptop;
  if (p.includes("linux")) return Monitor;
  if (p.includes("win")) return Laptop;
  if (p.includes("ios") || p.includes("android")) return Smartphone;
  return Server;
};

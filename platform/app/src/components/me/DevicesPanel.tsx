import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Laptop, Monitor, Server, Smartphone } from "lucide-react";
import { useState } from "react";

import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

import { InstallCliCard } from "./InstallCliCard";
import { usePersonalContext } from "./usePersonalContext";

/**
 * Where the CLI is signed in, and the way to take a device's access away.
 *
 * Lives beside the personal virtual keys on the configure page: a key and a
 * signed-in device are the two things that can talk to LangWatch as this
 * person, so revoking one is the same errand as revoking the other and they
 * belong within a tab of each other rather than a navigation apart.
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
  const [isPendingRevokeAll, setIsPendingRevokeAll] = useState(false);

  const sessionsQuery = api.personalSessions.list.useQuery(
    { organizationId },
    { enabled: ready },
  );
  const revocation = useDeviceRevocation({
    organizationId,
    isReady: ready,
    onDeviceRevoked: () => setPendingRevokeId(null),
    onEveryDeviceRevoked: () => setIsPendingRevokeAll(false),
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <VStack align="stretch" gap={4}>
      {sessions.length > 1 && !isPendingRevokeAll && (
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

      {isPendingRevokeAll && (
        <RevokeAllConfirmation
          isRevoking={revocation.isRevokingEveryDevice}
          onCancel={() => setIsPendingRevokeAll(false)}
          onConfirm={revocation.revokeEveryDevice}
        />
      )}

      {!ready || sessionsQuery.isLoading ? (
        <Text fontSize="sm" color="fg.muted" paddingY={8}>
          Loading devices…
        </Text>
      ) : sessions.length === 0 ? (
        <NoDevicesState />
      ) : (
        <VStack align="stretch" gap={2}>
          {sessions.map((session) => (
            <DeviceRow
              key={session.sessionStartedAtMs}
              session={session}
              isPendingRevoke={pendingRevokeId === session.sessionStartedAtMs}
              isRevoking={
                revocation.isRevokingDevice &&
                pendingRevokeId === session.sessionStartedAtMs
              }
              onRequestRevoke={() =>
                setPendingRevokeId(session.sessionStartedAtMs)
              }
              onCancelRevoke={() => setPendingRevokeId(null)}
              onConfirmRevoke={() =>
                revocation.revokeDevice(session.sessionStartedAtMs)
              }
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

/**
 * Taking one device's access away, or every device's. Both land the same way:
 * the tokens are cleared, the list is asked again, and the person is told how
 * many credentials stopped working.
 */
function useDeviceRevocation({
  organizationId,
  isReady,
  onDeviceRevoked,
  onEveryDeviceRevoked,
}: {
  organizationId: string;
  isReady: boolean;
  onDeviceRevoked: () => void;
  onEveryDeviceRevoked: () => void;
}) {
  const utils = api.useUtils();
  const refreshList = () =>
    void utils.personalSessions.list.invalidate({ organizationId });

  const revokeMutation = api.personalSessions.revoke.useMutation({
    onSuccess: (result) => {
      refreshList();
      onDeviceRevoked();
      toaster.create({
        title: "Device revoked",
        description: `Cleared ${tokenCount(result.revokedTokens)}. The CLI on that device will fail on its next request.`,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't revoke the device" }),
  });

  const revokeAllMutation = api.personalSessions.revokeAll.useMutation({
    onSuccess: (result) => {
      refreshList();
      onEveryDeviceRevoked();
      toaster.create({
        title: "All devices revoked",
        description: `Cleared ${tokenCount(result.revokedTokens)} across every device. You'll need to re-run \`langwatch login\` on each.`,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't revoke the devices" }),
  });

  return {
    isRevokingDevice: revokeMutation.isPending,
    isRevokingEveryDevice: revokeAllMutation.isPending,
    revokeDevice: (sessionStartedAtMs: number) => {
      if (!isReady) return;
      revokeMutation.mutate({ organizationId, sessionStartedAtMs });
    },
    revokeEveryDevice: () => {
      if (!isReady) return;
      revokeAllMutation.mutate({ organizationId });
    },
  };
}

const tokenCount = (count: number): string =>
  `${count} token${count === 1 ? "" : "s"}`;

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
        Revoke every device on your account? You'll need to re-run{" "}
        <code>langwatch login</code> on each device after this.
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

function DeviceRow({
  session,
  isPendingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
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
}) {
  const Icon = platformIcon(session.platform);
  const sub = [session.hostname, session.uname].filter(Boolean).join(" · ");

  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor={isPendingRevoke ? "red.emphasized" : "border.muted"}
      borderRadius="sm"
      padding={3}
    >
      <HStack gap={3}>
        <Box>
          <Icon size={20} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="medium">
              {session.deviceLabel}
            </Text>
            {session.platform && (
              <Badge variant="surface" size="sm" colorPalette="gray">
                {session.platform}
              </Badge>
            )}
          </HStack>
          {sub && (
            <Text fontSize="xs" color="fg.muted">
              {sub}
            </Text>
          )}
          <Text fontSize="xs" color="fg.muted">
            Last used {fmtRelative(session.lastSeenMs)} · Expires{" "}
            {fmtAbsolute(session.expiresAtMs)}
          </Text>
        </VStack>
        {!isPendingRevoke && (
          <Button
            size="sm"
            variant="outline"
            colorPalette="red"
            onClick={onRequestRevoke}
          >
            Revoke
          </Button>
        )}
      </HStack>
      {isPendingRevoke && (
        <HStack
          gap={2}
          paddingY={2}
          paddingX={3}
          backgroundColor="red.subtle"
          borderRadius="sm"
        >
          <Text fontSize="xs" color="red.fg" flex={1}>
            Revoke this device? The CLI on {session.hostname ?? "this device"}{" "}
            will start failing immediately.
          </Text>
          <Button
            size="xs"
            variant="ghost"
            onClick={onCancelRevoke}
            disabled={isRevoking}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            colorPalette="red"
            onClick={onConfirmRevoke}
            loading={isRevoking}
          >
            Confirm revoke
          </Button>
        </HStack>
      )}
    </VStack>
  );
}

const fmtRelative = (ms: number | null | undefined): string => {
  if (!ms) return "Never";
  const diffMs = Date.now() - ms;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
};

const fmtAbsolute = (ms: number | null | undefined): string =>
  !ms ? "—" : new Date(ms).toLocaleString();

const platformIcon = (platform: string | null) => {
  if (!platform) return Server;
  const p = platform.toLowerCase();
  if (p.includes("darwin") || p.includes("mac")) return Laptop;
  if (p.includes("linux")) return Monitor;
  if (p.includes("win")) return Laptop;
  if (p.includes("ios") || p.includes("android")) return Smartphone;
  return Server;
};

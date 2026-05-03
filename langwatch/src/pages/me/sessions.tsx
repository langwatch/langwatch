import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Laptop, Monitor, Server, Smartphone } from "lucide-react";
import { useState } from "react";
import Head from "~/utils/compat/next-head";

import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import MyLayout from "~/components/me/MyLayout";
import { usePersonalContext } from "~/components/me/usePersonalContext";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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

export default function MySessionsPage() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
    });
  const ctx = usePersonalContext();
  const [pendingRevokeId, setPendingRevokeId] = useState<number | null>(null);
  const [pendingRevokeAll, setPendingRevokeAll] = useState(false);

  const utils = api.useUtils();
  const sessionsQuery = api.personalSessions.list.useQuery(
    { organizationId: ctx.organizationId ?? "" },
    { enabled: !!ctx.organizationId },
  );

  const revokeMutation = api.personalSessions.revoke.useMutation({
    onSuccess: (res) => {
      void utils.personalSessions.list.invalidate({
        organizationId: ctx.organizationId,
      });
      setPendingRevokeId(null);
      toaster.create({
        title: "Session revoked",
        description: `Cleared ${res.revokedTokens} token${res.revokedTokens === 1 ? "" : "s"}. The CLI on that device will fail on its next request.`,
        type: "success",
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to revoke session",
        description: err.message,
        type: "error",
      });
    },
  });

  const revokeAllMutation = api.personalSessions.revokeAll.useMutation({
    onSuccess: (res) => {
      void utils.personalSessions.list.invalidate({
        organizationId: ctx.organizationId,
      });
      setPendingRevokeAll(false);
      toaster.create({
        title: "All sessions revoked",
        description: `Cleared ${res.revokedTokens} token${res.revokedTokens === 1 ? "" : "s"} across every device. You'll need to re-run \`langwatch login\` on each.`,
        type: "success",
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to revoke all sessions",
        description: err.message,
        type: "error",
      });
    },
  });

  if (ffLoading) return <LoadingScreen />;
  if (!governancePreviewEnabled) return <NotFoundScene />;

  const sessions = sessionsQuery.data ?? [];

  return (
    <MyLayout>
      <Head>
        <title>My Sessions · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              Sessions
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Devices where your CLI is signed in. Revoke any session that's
              stale, lost, or compromised.
            </Text>
          </VStack>
          <Spacer />
          {sessions.length > 1 && !pendingRevokeAll && (
            <Button
              size="sm"
              variant="outline"
              colorPalette="red"
              onClick={() => setPendingRevokeAll(true)}
            >
              Revoke all
            </Button>
          )}
        </HStack>

        {pendingRevokeAll && (
          <HStack
            gap={2}
            paddingY={2}
            paddingX={3}
            backgroundColor="red.50"
            borderRadius="sm"
            borderWidth="1px"
            borderColor="red.300"
          >
            <Text fontSize="xs" color="red.700" flex={1}>
              Revoke every session for your account? You'll need to re-run{" "}
              <code>langwatch login</code> on each device after this.
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPendingRevokeAll(false)}
              disabled={revokeAllMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              colorPalette="red"
              onClick={() =>
                ctx.organizationId &&
                revokeAllMutation.mutate({ organizationId: ctx.organizationId })
              }
              loading={revokeAllMutation.isPending}
            >
              Confirm revoke all
            </Button>
          </HStack>
        )}

        {sessionsQuery.isLoading ? (
          <Box paddingY={8}>
            <Text fontSize="sm" color="fg.muted">
              Loading sessions…
            </Text>
          </Box>
        ) : sessions.length === 0 ? (
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={6}
          >
            <VStack align="start" gap={2}>
              <Text fontSize="sm" fontWeight="medium">
                No active CLI sessions
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Run <code>langwatch login</code> in your terminal to sign in
                from this device.
              </Text>
            </VStack>
          </Box>
        ) : (
          <VStack align="stretch" gap={2}>
            {sessions.map((s) => (
              <SessionRow
                key={s.sessionStartedAtMs}
                session={s}
                isPendingRevoke={pendingRevokeId === s.sessionStartedAtMs}
                isRevoking={
                  revokeMutation.isPending &&
                  pendingRevokeId === s.sessionStartedAtMs
                }
                onRequestRevoke={() =>
                  setPendingRevokeId(s.sessionStartedAtMs)
                }
                onCancelRevoke={() => setPendingRevokeId(null)}
                onConfirmRevoke={() => {
                  if (!ctx.organizationId) return;
                  revokeMutation.mutate({
                    organizationId: ctx.organizationId,
                    sessionStartedAtMs: s.sessionStartedAtMs,
                  });
                }}
              />
            ))}
          </VStack>
        )}
      </VStack>
    </MyLayout>
  );
}

function SessionRow({
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
  const sub = [session.hostname, session.uname]
    .filter(Boolean)
    .join(" · ");

  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor={isPendingRevoke ? "red.300" : "border.muted"}
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
          backgroundColor="red.50"
          borderRadius="sm"
        >
          <Text fontSize="xs" color="red.700" flex={1}>
            Revoke this session? The CLI on{" "}
            {session.hostname ?? "this device"} will start failing immediately.
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

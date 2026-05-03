import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Copy,
  Laptop,
  Monitor,
  Server,
} from "lucide-react";
import { useState } from "react";
import Head from "~/utils/compat/next-head";

import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import MyLayout from "~/components/me/MyLayout";
import {
  type PersonalApiKeyRow,
  usePersonalContext,
} from "~/components/me/usePersonalContext";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
};

const fmtUsd = (amount: number): string =>
  amount === 0
    ? "$0.00"
    : `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MySettingsPage() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  // /me/settings is the persona-1 (org-less CLI/IDE dev) home — must
  // resolve the FF without project context. See sibling /me/index for
  // the same fix.
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
    });
  const ctx = usePersonalContext();
  const [prefs, setPrefs] = useState(ctx.notificationPrefs);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{
    label: string;
    secret: string;
    baseUrl: string;
  } | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  const utils = api.useUtils();
  const issueMutation = api.personalVirtualKeys.issuePersonal.useMutation({
    onSuccess: (issued) => {
      setRevealedSecret({
        label: issued.label,
        secret: issued.secret,
        baseUrl: issued.baseUrl,
      });
      setNewKeyLabel("");
      setShowAddForm(false);
      void utils.personalVirtualKeys.list.invalidate({
        organizationId: ctx.organizationId,
      });
      toaster.create({
        title: `Issued personal key '${issued.label}'`,
        type: "success",
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to issue key",
        description: err.message,
        type: "error",
      });
    },
  });

  const revokeMutation = api.personalVirtualKeys.revokePersonal.useMutation({
    onSuccess: () => {
      void utils.personalVirtualKeys.list.invalidate({
        organizationId: ctx.organizationId,
      });
      setPendingRevokeId(null);
      toaster.create({
        title: "Key revoked",
        description: "The CLI/tool using this key will fail immediately.",
        type: "success",
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to revoke key",
        description: err.message,
        type: "error",
      });
    },
  });

  const onIssue = () => {
    if (!newKeyLabel.trim() || !ctx.organizationId) return;
    issueMutation.mutate({
      organizationId: ctx.organizationId,
      label: newKeyLabel.trim(),
    });
  };

  const onRevoke = (id: string) => {
    if (!ctx.organizationId) return;
    revokeMutation.mutate({ organizationId: ctx.organizationId, id });
  };

  if (ffLoading) {
    return <LoadingScreen />;
  }
  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  return (
    <MyLayout>
      <Head>
        <title>My Settings · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              Settings
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Manage your personal API keys, notifications, and view your
              admin-managed budget
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <SectionCard title="Profile">
          <VStack align="stretch" gap={3}>
            <Field label="Name" value={ctx.fullName} />
            <Field
              label="Email"
              value={ctx.email}
              hint={`Managed by ${ctx.organizationName} IT`}
            />
            <Field label="Joined" value={ctx.joinedOn} />
            {ctx.routingPolicyName && (
              <Field
                label="Routing"
                value={
                  <HStack gap={2}>
                    <Text>{ctx.routingPolicyName}</Text>
                    <Badge variant="surface" colorPalette="gray" size="sm">
                      managed by your org
                    </Badge>
                  </HStack>
                }
              />
            )}
          </VStack>
        </SectionCard>

        <SectionCard
          title="Personal API Keys"
          description="These keys let your CLI tools (Claude Code, Cursor, etc.) talk to LangWatch."
          action={
            !showAddForm && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddForm(true)}
              >
                + Add a new key
              </Button>
            )
          }
        >
          {revealedSecret && (
            <RevealedSecretBanner
              secret={revealedSecret}
              onDismiss={() => setRevealedSecret(null)}
            />
          )}

          {showAddForm && (
            <Box
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="sm"
              padding={3}
              marginBottom={3}
            >
              <VStack align="stretch" gap={2}>
                <Text fontSize="sm" fontWeight="medium">
                  New personal key
                </Text>
                <Input
                  placeholder="e.g. jane-laptop-2"
                  size="sm"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                />
                <Text fontSize="xs" color="fg.muted">
                  Lowercase letters, numbers, dash, underscore. The secret is
                  shown once on creation.
                </Text>
                <HStack gap={2}>
                  <Button
                    size="sm"
                    onClick={onIssue}
                    loading={issueMutation.isPending}
                    disabled={!newKeyLabel.trim()}
                  >
                    Create key
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewKeyLabel("");
                    }}
                  >
                    Cancel
                  </Button>
                </HStack>
              </VStack>
            </Box>
          )}

          {ctx.apiKeys.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No personal keys yet. Run <code>langwatch login</code> in your
              terminal to issue your first one.
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {ctx.apiKeys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  isPendingRevoke={pendingRevokeId === key.id}
                  isRevoking={
                    revokeMutation.isPending && pendingRevokeId === key.id
                  }
                  onRequestRevoke={() => setPendingRevokeId(key.id)}
                  onCancelRevoke={() => setPendingRevokeId(null)}
                  onConfirmRevoke={() => onRevoke(key.id)}
                />
              ))}
            </VStack>
          )}
        </SectionCard>

        <SectionCard title="Notifications">
          <VStack align="stretch" gap={2}>
            <Text fontSize="xs" color="fg.muted">
              Notification preferences are not yet persisted — UI preview only.
              Coming in a follow-up release.
            </Text>
            <CheckboxRow
              label="Alert me when I hit 80% of my monthly budget"
              checked={prefs.budgetThreshold80}
              onChange={(v) =>
                setPrefs({ ...prefs, budgetThreshold80: v })
              }
              disabled
            />
            <CheckboxRow
              label="Weekly usage summary"
              checked={prefs.weeklySummary}
              onChange={(v) => setPrefs({ ...prefs, weeklySummary: v })}
              disabled
            />
            <CheckboxRow
              label="Each request over $1.00"
              checked={prefs.perRequestOverOneDollar}
              onChange={(v) =>
                setPrefs({ ...prefs, perRequestOverOneDollar: v })
              }
              disabled
            />
          </VStack>
        </SectionCard>

        <SectionCard title="Budget">
          {ctx.summary.budgetUsd === null ? (
            <VStack align="start" gap={1}>
              <Text fontSize="sm" color="fg.muted">
                No personal budget set by your admin.
              </Text>
              <Text fontSize="xs" color="fg.muted">
                If you'd like one, ask your admin.
              </Text>
            </VStack>
          ) : (
            <VStack align="stretch" gap={3}>
              <Field
                label="Monthly limit"
                value={fmtUsd(ctx.summary.budgetUsd)}
                hint={`Set by your ${ctx.organizationName} admin · cannot edit`}
              />
              <Field
                label="Current spend"
                value={fmtUsd(ctx.summary.spentThisMonthUsd)}
              />
            </VStack>
          )}
        </SectionCard>
      </VStack>
    </MyLayout>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
      <HStack alignItems="start" marginBottom={3}>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="semibold">
            {title}
          </Text>
          {description && (
            <Text fontSize="xs" color="fg.muted">
              {description}
            </Text>
          )}
        </VStack>
        <Spacer />
        {action}
      </HStack>
      {children}
    </Box>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <HStack alignItems="start" gap={4}>
      <Text fontSize="sm" color="fg.muted" minWidth="100px" paddingTop={1}>
        {label}
      </Text>
      <VStack align="start" gap={0}>
        {typeof value === "string" ? (
          <Text fontSize="sm">{value}</Text>
        ) : (
          value
        )}
        {hint && (
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

function ApiKeyRow({
  apiKey,
  isPendingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  apiKey: PersonalApiKeyRow;
  isPendingRevoke: boolean;
  isRevoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
}) {
  const Icon =
    apiKey.os === "macOS" || apiKey.os === "Windows"
      ? Laptop
      : apiKey.os === "Linux"
        ? Monitor
        : Server;

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
          <Text fontSize="sm" fontWeight="medium">
            {apiKey.label}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {apiKey.deviceHint} · Last used {fmtRelative(apiKey.lastUsedAt)}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Created {fmtRelative(apiKey.createdAt)}
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
            Revoke this key? Any tool using it will start failing immediately.
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

function RevealedSecretBanner({
  secret,
  onDismiss,
}: {
  secret: { label: string; secret: string; baseUrl: string };
  onDismiss: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="green.300"
      backgroundColor="green.50"
      borderRadius="md"
      padding={3}
      marginBottom={3}
    >
      <VStack align="stretch" gap={2}>
        <HStack>
          <Text fontWeight="semibold" color="green.800">
            New key '{secret.label}' created
          </Text>
          <Spacer />
          <Button size="xs" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </HStack>
        <Text fontSize="xs" color="green.800">
          Copy the secret now — you won't be able to see it again.
        </Text>
        <HStack
          gap={2}
          paddingX={2}
          paddingY={2}
          backgroundColor="white"
          borderRadius="sm"
          borderWidth="1px"
          borderColor="border.muted"
        >
          <Text
            fontSize="xs"
            fontFamily="mono"
            flex={1}
            wordBreak="break-all"
          >
            {secret.secret}
          </Text>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(secret.secret);
              toaster.create({
                title: "Secret copied to clipboard",
                type: "success",
              });
            }}
          >
            <Copy size={14} /> Copy
          </Button>
        </HStack>
        <Text fontSize="xs" color="green.800">
          Gateway base URL: <code>{secret.baseUrl}</code>
        </Text>
      </VStack>
    </Box>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <HStack
      paddingY={1}
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      gap={3}
      opacity={disabled ? 0.5 : 1}
    >
      <Box
        width="16px"
        height="16px"
        borderRadius="sm"
        borderWidth="1px"
        borderColor={checked ? "blue.500" : "border.emphasis"}
        backgroundColor={checked ? "blue.500" : "transparent"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        color="white"
        fontSize="10px"
      >
        {checked && "✓"}
      </Box>
      <Text fontSize="sm">{label}</Text>
    </HStack>
  );
}

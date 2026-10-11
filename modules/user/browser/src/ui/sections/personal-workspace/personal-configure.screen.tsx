import { Banner } from "@langwatch/design-system/banner";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { toEpochMs } from "@langwatch/time";
import { Copy, Laptop, Monitor, Server } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../../behavior/personal-workspace-api.ts";
import {
  usePersonalToaster,
  useShowErrorToast,
} from "../../../behavior/personal-workspace-feedback.ts";
import { usePersonalRouter } from "../../../behavior/personal-workspace-router.ts";
import {
  type PersonalApiKeyRow,
  type PersonalBudgetOverview,
  usePersonalContext,
} from "../../../behavior/use-personal-context.ts";
import {
  PERSONAL_WORKSPACE_WAIT_HINT,
  usePersonalWorkspaceWait,
} from "../../../behavior/use-personal-workspace-wait.ts";
import { formatRelativeTime } from "../../../model/relative-time.ts";
import { CredentialCard, RevokeConfirmation } from "../../blocks/credential-cards.tsx";
import { Link } from "../../elements/personal-link.tsx";
import { BudgetOverviewList } from "../budget-overview/index.ts";
import { DevicesPanel } from "../devices-panel.tsx";
import { HomePagePicker } from "../home-page-picker.tsx";
import { PersonalOtlpEndpointPanel } from "../personal-otlp-endpoint-panel.tsx";
import { PersonalWorkspaceLayout } from "../personal-workspace-layout.tsx";

/** The personal keys carry ISO timestamps; the ladder counts milliseconds. */
const fmtRelative = (iso: string | null): string => formatRelativeTime(iso ? toEpochMs(iso) : null);

export function PersonalConfigureScreen() {
  const ctx = usePersonalContext();

  const personalContextQuery = api.routingPolicy.personalContext.useQuery(
    { organizationId: ctx.organizationId },
    { enabled: !!ctx.organizationId, refetchOnWindowFocus: false },
  );
  const personalProjectId = personalContextQuery.data?.workspace.project.id ?? null;

  return (
    <>
      <PageLayout.Header
        actions={
          <PageLayout.HeaderButton asChild>
            <Link unstyled href="/settings/profile">
              Edit profile
            </Link>
          </PageLayout.HeaderButton>
        }
      >
        <PageLayout.Heading>Personal configuration</PageLayout.Heading>
      </PageLayout.Header>
      <PersonalWorkspaceLayout>
        <VStack align="stretch" gap={6} width="full">
          <Text color="fg.muted" fontSize="sm">
            Manage your personal API keys and view your admin-managed budget
          </Text>

          <SectionCard title="Profile">
            <VStack align="stretch" gap={4}>
              <Field label="Name" value={ctx.fullName} />
              <Field label="Email" value={ctx.email} />
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

          <PersonalCredentialsSection organizationId={ctx.organizationId} apiKeys={ctx.apiKeys} />

          {ctx.organizationId ? (
            <SectionCard
              title="Default landing page"
              description="Where to land when you open LangWatch. Auto uses your detected persona."
            >
              <HomePagePicker organizationId={ctx.organizationId} />
            </SectionCard>
          ) : null}

          {personalProjectId && ctx.organizationId ? (
            <SectionCard
              title="Personal OTLP Endpoint"
              description="Send raw OTLP traces directly to your personal workspace."
            >
              <PersonalOtlpEndpointPanel
                organizationId={ctx.organizationId}
                projectId={personalProjectId}
              />
            </SectionCard>
          ) : null}

          {personalProjectId ? <WorkspaceFeaturesSection projectId={personalProjectId} /> : null}

          {ctx.budgetOverview.gatewayAccess && (
            <BudgetsSection budgetOverview={ctx.budgetOverview} />
          )}
        </VStack>
      </PersonalWorkspaceLayout>
    </>
  );
}

function PersonalCredentialsSection({
  organizationId,
  apiKeys,
}: {
  organizationId: string;
  apiKeys: PersonalApiKeyRow[];
}) {
  const toaster = usePersonalToaster();
  const showErrorToast = useShowErrorToast();
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{
    label: string;
    secret: string;
    baseUrl: string;
  } | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  // Which tab is open is part of the address rather than a choice the page
  // forgets on reload: the devices inventory is linked to directly, from the
  // docs and from the old /me/devices path, and a link that lands on the keys
  // tab does not take the reader where it said it would.
  const router = usePersonalRouter();
  const credentialsTab = router.query.tab === "devices" ? "devices" : "keys";
  const selectCredentialsTab = (tab: string) =>
    // Keys is the default, so it stays out of the address entirely.
    router.setQueryParam("tab", tab === "devices" ? tab : void 0, { replace: true });

  const utils = api.useUtils();
  const workspaceWait = usePersonalWorkspaceWait({ organizationId });
  const issueMutation = api.personalVirtualKeys.issuePersonal.useMutation({
    onSuccess: (issued) => {
      setRevealedSecret({
        label: issued.label,
        secret: issued.secret,
        baseUrl: issued.baseUrl,
      });
      setNewKeyLabel("");
      setLabelError(null);
      setShowAddForm(false);
      void utils.personalVirtualKeys.list.invalidate();
      toaster.create({
        title: `Issued personal key '${issued.label}'`,
        type: "success",
      });
    },
    onError: (err) => {
      if (workspaceWait.absorb(err)) return;
      showErrorToast({ error: err, fallbackTitle: "Couldn't issue the personal key" });
    },
  });

  const revokeMutation = api.personalVirtualKeys.revokePersonal.useMutation({
    onSuccess: () => {
      void utils.personalVirtualKeys.list.invalidate();
      setPendingRevokeId(null);
      toaster.create({
        title: "Key revoked",
        description: "The CLI/tool using this key will fail immediately.",
        type: "success",
      });
    },
    onError: (err) => showErrorToast({ error: err, fallbackTitle: "Couldn't revoke the key" }),
  });

  const onIssue = () => {
    if (!newKeyLabel.trim()) {
      setLabelError("Give the key a name.");
      labelInput.current?.focus();
      return;
    }
    if (!organizationId) return;
    issueMutation.mutate({
      organizationId: organizationId,
      label: newKeyLabel.trim(),
    });
  };

  const onRevoke = (id: string) => {
    if (!organizationId) return;
    revokeMutation.mutate({ organizationId: organizationId, id });
  };

  return (
    <SectionCard
      title="Personal credentials"
      description="The keys your tools (Claude Code, Cursor, and the rest) use to reach LangWatch, and the devices your CLI is signed in on. Revoke anything that is stale, lost or compromised."
      action={
        credentialsTab === "keys" &&
        !showAddForm && (
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
            Add a new key
          </Button>
        )
      }
    >
      <ContentTabs
        label="Personal credentials"
        value={credentialsTab}
        onValueChange={({ value }) => selectCredentialsTab(value)}
        // The devices panel reads its inventory on mount, so it is not mounted until the reader
        // opens that tab, and arrowing past it selects nothing.
        mount="lazy"
        activationMode="manual"
        body="flush"
        items={[
          {
            value: "keys",
            label: "Virtual keys",
            content: (
              <VStack align="stretch" gap={3} paddingTop={7}>
                {revealedSecret && (
                  <RevealedSecretBanner
                    secret={revealedSecret}
                    onDismiss={() => setRevealedSecret(null)}
                  />
                )}

                {showAddForm && (
                  <Box borderWidth="1px" borderColor="border.muted" borderRadius="sm" padding={3}>
                    <VStack align="stretch" gap={2}>
                      <Text fontSize="sm" fontWeight="medium">
                        New personal key
                      </Text>
                      <SettingsField
                        layout="stacked"
                        label="Name"
                        hint="Lowercase letters, numbers, dash, underscore. The secret is shown once on creation."
                        error={labelError}
                      >
                        <Input
                          ref={labelInput}
                          placeholder="e.g. jane-laptop-2"
                          size="sm"
                          value={newKeyLabel}
                          onChange={(e) => {
                            setNewKeyLabel(e.target.value);
                            setLabelError(null);
                          }}
                        />
                      </SettingsField>
                      {workspaceWait.waiting && (
                        <Text fontSize="xs" color="fg.muted" as="output" display="block">
                          {PERSONAL_WORKSPACE_WAIT_HINT}
                        </Text>
                      )}
                      <HStack gap={2}>
                        <Button
                          size="sm"
                          onClick={onIssue}
                          loading={issueMutation.isPending}
                          disabled={workspaceWait.waiting}
                        >
                          Create key
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setShowAddForm(false);
                            setNewKeyLabel("");
                            setLabelError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </HStack>
                    </VStack>
                  </Box>
                )}

                {apiKeys.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    No virtual keys yet. Add a key for a tool, or run{" "}
                    <InlineCode>langwatch login</InlineCode> in your terminal to connect a device.
                  </Text>
                ) : (
                  <VStack align="stretch" gap={2}>
                    {apiKeys.map((key) => (
                      <ApiKeyRow
                        key={key.id}
                        apiKey={key}
                        isPendingRevoke={pendingRevokeId === key.id}
                        isRevoking={revokeMutation.isPending && pendingRevokeId === key.id}
                        onRequestRevoke={() => setPendingRevokeId(key.id)}
                        onCancelRevoke={() => setPendingRevokeId(null)}
                        onConfirmRevoke={() => onRevoke(key.id)}
                      />
                    ))}
                  </VStack>
                )}
              </VStack>
            ),
          },
          {
            value: "devices",
            label: "Devices and keys",
            content: (
              <Box paddingTop={7}>
                <DevicesPanel />
              </Box>
            ),
          },
        ]}
      />
    </SectionCard>
  );
}

function WorkspaceFeaturesSection({ projectId }: { projectId: string }) {
  const toaster = usePersonalToaster();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const featuresQuery = api.personalWorkspaceFeatures.get.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  );
  const featuresEnabled = !!(
    featuresQuery.data?.evaluations &&
    featuresQuery.data?.datasets &&
    featuresQuery.data?.annotations &&
    featuresQuery.data?.automations
  );
  const enableAllMutation = api.personalWorkspaceFeatures.enableAll.useMutation({
    onSuccess: () => {
      void utils.personalWorkspaceFeatures.get.invalidate({ projectId });
      toaster.create({
        title: "Advanced features enabled",
        description:
          "Evaluations, datasets, annotations, and automations now appear in your sidebar.",
        type: "success",
      });
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't enable advanced features",
      }),
  });
  const disableAllMutation = api.personalWorkspaceFeatures.disableAll.useMutation({
    onSuccess: () => {
      void utils.personalWorkspaceFeatures.get.invalidate({ projectId });
      toaster.create({
        title: "Advanced features disabled",
        description:
          "Sidebar entries hidden. Existing data is preserved and reappears on re-enable.",
        type: "success",
      });
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't disable advanced features",
      }),
  });

  return (
    <SectionCard
      title="Workspace features"
      description="Evaluations, datasets, annotations, and automations are powerful for personal projects too - turn them on when you're ready. Disabling later hides the sidebar entries; existing data is preserved."
    >
      <Checkbox
        checked={featuresEnabled}
        disabled={
          featuresQuery.isLoading || enableAllMutation.isPending || disableAllMutation.isPending
        }
        onCheckedChange={(details) => {
          if (details.checked) {
            enableAllMutation.mutate({ projectId });
          } else {
            disableAllMutation.mutate({ projectId });
          }
        }}
      >
        Enable advanced features (evaluations, datasets, annotations, automations)
      </Checkbox>
    </SectionCard>
  );
}

function BudgetsSection({ budgetOverview }: { budgetOverview: PersonalBudgetOverview }) {
  const hasBudgets = budgetOverview.budgets.length > 0;
  return (
    <SectionCard title="Budgets that apply to you">
      {hasBudgets && <BudgetOverviewList items={budgetOverview.budgets} />}
      {!hasBudgets && budgetOverview.isResolved && (
        <NoDataInfoBlock
          size="line"
          title="No budgets apply to your usage yet. If you'd like one, ask your admin."
        />
      )}
    </SectionCard>
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
      background="bg.card"
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

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <HStack alignItems="start" gap={4}>
      <Text fontSize="sm" color="fg.muted" minWidth="100px" paddingTop={1}>
        {label}
      </Text>
      <VStack align="start" gap={0}>
        {typeof value === "string" ? <Text fontSize="sm">{value}</Text> : value}
        {hint && (
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

function osIcon(os: PersonalApiKeyRow["os"]) {
  if (os === "macOS" || os === "Windows") return Laptop;
  if (os === "Linux") return Monitor;
  return Server;
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
  const Icon = osIcon(apiKey.os);

  return (
    <CredentialCard
      icon={<Icon size={20} />}
      title={apiKey.label}
      subline={`${apiKey.deviceHint} · Last used ${fmtRelative(apiKey.lastUsedAt)}`}
      meta={
        <Text fontSize="xs" color="fg.muted">
          Created {fmtRelative(apiKey.createdAt)}
        </Text>
      }
      isPendingRevoke={isPendingRevoke}
      action={
        isPendingRevoke ? null : (
          <Button size="sm" variant="outline" colorPalette="red" onClick={onRequestRevoke}>
            Revoke
          </Button>
        )
      }
      confirmation={
        isPendingRevoke ? (
          <RevokeConfirmation
            question="Revoke this key? Any tool using it will start failing immediately."
            isRevoking={isRevoking}
            onCancel={onCancelRevoke}
            onConfirm={onConfirmRevoke}
          />
        ) : null
      }
    />
  );
}

function RevealedSecretBanner({
  secret,
  onDismiss,
}: {
  secret: { label: string; secret: string; baseUrl: string };
  onDismiss: () => void;
}) {
  const toaster = usePersonalToaster();
  const [copyFailed, setCopyFailed] = useState(false);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret.secret);
    } catch {
      setCopyFailed(true);
      return;
    }
    setCopyFailed(false);
    toaster.create({ title: "Secret copied to clipboard", type: "success" });
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="green.emphasized"
      backgroundColor="green.subtle"
      borderRadius="md"
      padding={3}
    >
      <VStack align="stretch" gap={2}>
        <HStack>
          <Text fontWeight="semibold" color="green.fg">
            New key '{secret.label}' created
          </Text>
          <Spacer />
          <Button size="xs" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </HStack>
        <Text fontSize="xs" color="green.fg">
          Copy the secret now - you won't be able to see it again.
        </Text>
        <HStack
          gap={2}
          paddingX={2}
          paddingY={2}
          backgroundColor="bg.card"
          borderRadius="sm"
          borderWidth="1px"
          borderColor="border.muted"
        >
          <Text fontSize="xs" fontFamily="mono" flex={1} wordBreak="break-all">
            {secret.secret}
          </Text>
          <Button size="xs" variant="ghost" onClick={() => void copySecret()}>
            <Copy size={14} /> {copyFailed ? "Try again" : "Copy"}
          </Button>
        </HStack>
        {copyFailed && (
          <Banner status="error">
            Couldn't copy to the clipboard. Select the secret above and copy it by hand, or try
            again. It won't be shown again once you dismiss this.
          </Banner>
        )}
        <Text fontSize="xs" color="green.fg">
          Gateway base URL: <InlineCode>{secret.baseUrl}</InlineCode>
        </Text>
      </VStack>
    </Box>
  );
}

export default PersonalConfigureScreen;

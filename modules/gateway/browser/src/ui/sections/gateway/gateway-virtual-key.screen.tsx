import {
  Badge,
  Box,
  Button,
  Code,
  chakra,
  Heading,
  HStack,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { VirtualKeyCamelDtoResponse } from "@langwatch/gateway-contract";
import { Temporal, formatDistanceToNow, toEpochMs } from "@langwatch/time";
import {
  ArrowLeft,
  Bird,
  FileClock,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../../../behavior/gateway-api.ts";
import { useShowErrorToast } from "../../../behavior/gateway-feedback.ts";
import { useGatewayRouter } from "../../../behavior/gateway-router.ts";
import { useOrganizationTeamProject } from "../../../behavior/gateway-session.ts";
import { useRollingWindow } from "../../../behavior/use-rolling-window.ts";
import { GuardrailAttachmentsSection } from "../../../features/guardrails/ui/sections/guardrail-attachments-section.tsx";
import {
  firstEligibleDefaultModel,
  type OrgModelProvider,
} from "../../../features/virtual-keys/model/eligible-model-providers.ts";
import { resolveTracesHrefForKey } from "../../../features/virtual-keys/model/traces-href-for-key.ts";
import {
  formatExpiry,
  isExpired,
} from "../../../features/virtual-keys/model/virtual-key-expiration.ts";
import {
  ConfigureModelProvidersLink,
  EligibleModelProvidersPreview,
  EligibleModelProvidersSummary,
} from "../../../features/virtual-keys/ui/blocks/eligible-model-providers-preview.tsx";
import { VirtualKeyOwnershipReadOnly } from "../../../features/virtual-keys/ui/blocks/virtual-key-ownership-section.tsx";
import {
  type VirtualKeyDetail,
  VirtualKeyEditDrawer,
} from "../../../features/virtual-keys/ui/sections/virtual-key-edit-drawer.tsx";
import { VirtualKeySecretReveal } from "../../../features/virtual-keys/ui/sections/virtual-key-secret-reveal.tsx";
import { VirtualKeyUsageSnippet } from "../../../features/virtual-keys/ui/sections/virtual-key-usage-snippet.tsx";
import type { GatewayTeam } from "../../../model/gateway-host.ts";
import { keepPreviousData } from "../../../model/keep-previous-data.ts";
import { readableDate } from "../../../model/readable-date.ts";
import { Link } from "../../../ui/elements/gateway-link.tsx";
import AiGatewayLayout from "../../../ui/sections/gateway-layout.tsx";

function availableProjectsOf(
  teams: readonly GatewayTeam[],
): { id: string; name: string; teamId: string }[] {
  return teams.flatMap((t) =>
    t.projects.map((p) => ({
      id: p.id,
      name: `${p.name} · ${t.name}`,
      teamId: t.id,
    })),
  );
}

/** Guardrails are project-scoped: only a key reaching exactly one project has one to edit. */
function guardrailProjectOf(input: {
  scopes: readonly { scopeType: string; scopeId: string }[];
  teams: readonly GatewayTeam[];
}): { id: string; slug: string | null } | null {
  const projectScopes = input.scopes.filter((s) => s.scopeType === "PROJECT");
  if (projectScopes.length !== 1) return null;
  const id = projectScopes[0]!.scopeId;
  for (const t of input.teams) {
    const p = t.projects.find((proj) => proj.id === id);
    if (p) return { id: p.id, slug: p.slug };
  }
  return { id, slug: null as string | null };
}

function tracesHrefFor(input: {
  vk: { id: string; traceProjectId: string | null; traceProjectArchived: boolean } | undefined;
  teams: readonly GatewayTeam[];
  model?: string | null;
}): string | undefined {
  if (!input.vk) return undefined;
  return resolveTracesHrefForKey({
    teams: input.teams,
    virtualKeyId: input.vk.id,
    traceProjectId: input.vk.traceProjectId,
    traceProjectArchived: input.vk.traceProjectArchived,
    ...(input.model === undefined ? {} : { model: input.model }),
  });
}

function stringIdsOf(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

function VirtualKeyIdentitySection({
  vk,
}: {
  vk: Pick<VirtualKeyCamelDtoResponse, "displayPrefix" | "status" | "expiresAt" | "description">;
}) {
  return (
    <Section title="Identity">
      <DetailRow label="Prefix">
        <HStack gap={1}>
          <Code fontSize="xs">{vk.displayPrefix}…</Code>
          <FieldInfoTooltip description="First chars of the secret. The full secret is shown only once at create or rotate: if it's lost, rotate the key to mint a fresh one." />
        </HStack>
      </DetailRow>
      <DetailRow label="Status">
        <Badge colorPalette={statusPalette(vk)} data-testid="vk-detail-status">
          {vk.status === "active" && isExpired(vk.expiresAt) ? "expired" : vk.status}
        </Badge>
      </DetailRow>
      <DetailRow label="Expires">
        {vk.expiresAt ? (
          <Tooltip content={readableDate(vk.expiresAt).toLocaleString()}>
            <Text fontSize="sm" color="fg.muted" data-testid="vk-detail-expires">
              {formatExpiry(Temporal.Instant.fromEpochMilliseconds(toEpochMs(vk.expiresAt)))} (
              {formatDistanceToNow(vk.expiresAt, { addSuffix: true })})
            </Text>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="fg.muted" data-testid="vk-detail-expires">
            Never
          </Text>
        )}
      </DetailRow>
      {vk.description && (
        <DetailRow label="Description">
          <Text fontSize="sm">{vk.description}</Text>
        </DetailRow>
      )}
    </Section>
  );
}

function VirtualKeyActivitySection({
  vk,
}: {
  vk: Pick<VirtualKeyCamelDtoResponse, "lastUsedAt" | "createdAt" | "revision">;
}) {
  return (
    <Section title="Activity">
      <DetailRow label="Last used">
        {vk.lastUsedAt ? (
          <Tooltip content={readableDate(vk.lastUsedAt).toLocaleString()}>
            <Text fontSize="sm" color="fg.muted">
              {formatTimeAgo(toEpochMs(vk.lastUsedAt))}
            </Text>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            never
          </Text>
        )}
      </DetailRow>
      <DetailRow label="Created">
        <Tooltip content={readableDate(vk.createdAt).toLocaleString()}>
          <Text fontSize="sm" color="fg.muted">
            {formatTimeAgo(toEpochMs(vk.createdAt))}
          </Text>
        </Tooltip>
      </DetailRow>
      <DetailRow label="Revision">
        <Text fontSize="sm" color="fg.muted">
          {vk.revision}
        </Text>
      </DetailRow>
    </Section>
  );
}

/** What can be done to the key from its header, by its status and the viewer's grants. */
function VirtualKeyHeaderActions({
  vk,
  viewTracesHref,
  canUpdate,
  canRotate,
  isEnabling,
  onEdit,
  onRotate,
  onDisable,
  onEnable,
  onRevoke,
}: {
  vk: { id: string; status: "active" | "disabled" | "revoked" };
  viewTracesHref: string | undefined;
  canUpdate: boolean;
  canRotate: boolean;
  isEnabling: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onRevoke: () => void;
}) {
  return (
    <HStack>
      {/* Audit history stays available even when revoked —
          operators forensically investigating a revoked VK
          still need its create/update/rotate/revoke trail. */}
      <Link href={`/settings/audit-log?targetKind=virtual_key&targetId=${vk.id}`}>
        <Button variant="outline" size="sm">
          <FileClock size={14} /> Audit history
        </Button>
      </Link>
      {/* Traces outlive the key, so this is offered whatever the
          key's status: investigating what a revoked key did is
          exactly when somebody needs it. */}
      {viewTracesHref && (
        <Link href={viewTracesHref}>
          <Button variant="outline" size="sm" data-testid="vk-header-view-traces">
            <Bird size={14} /> View traces
          </Button>
        </Link>
      )}
      {vk.status === "active" && canUpdate && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil size={14} /> Edit
        </Button>
      )}
      {vk.status === "active" && canRotate && (
        <Button variant="outline" size="sm" onClick={onRotate}>
          <RotateCw size={14} /> Rotate
        </Button>
      )}
      {vk.status === "active" && canUpdate && (
        <Button variant="outline" size="sm" onClick={onDisable}>
          <PauseCircle size={14} /> Disable
        </Button>
      )}
      {vk.status === "disabled" && canUpdate && (
        <Button variant="outline" size="sm" loading={isEnabling} onClick={onEnable}>
          <PlayCircle size={14} /> Enable
        </Button>
      )}
      {vk.status !== "revoked" && canUpdate && (
        <Button colorPalette="red" variant="outline" size="sm" onClick={onRevoke}>
          <Trash2 size={14} /> Revoke
        </Button>
      )}
    </HStack>
  );
}

/** Runs one lifecycle action on a loaded key; a failure is shown to the user, not thrown. */
async function runKeyAction<Key>(input: {
  vk: Key | undefined;
  organizationId: string;
  action: (vk: Key, organizationId: string) => Promise<void>;
  onFailure: (error: unknown) => void;
}): Promise<void> {
  if (!input.vk || !input.organizationId) return;
  try {
    await input.action(input.vk, input.organizationId);
  } catch (err) {
    input.onFailure(err);
  }
}

function VirtualKeyDetailPage() {
  const showErrorToast = useShowErrorToast();
  const { organization, hasPermission } = useOrganizationTeamProject();
  const router = useGatewayRouter();
  const vkId = typeof router.query.id === "string" ? router.query.id : "";
  const orgId = organization?.id ?? "";

  const detailQuery = api.virtualKeys.get.useQuery(
    { organizationId: orgId, id: vkId },
    { enabled: !!orgId && !!vkId },
  );
  const orgProvidersQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );
  // Reading a policy needs `routingPolicies:view`, which is stricter than
  // the permission that opens this page, so the query is allowed to fail:
  // the section falls back to the stored identifier rather than the name.
  const routingPolicyId = detailQuery.data?.routingPolicyId ?? null;
  const routingPolicyQuery = api.routingPolicy.get.useQuery(
    { organizationId: orgId, id: routingPolicyId ?? "" },
    { enabled: !!orgId && !!routingPolicyId, retry: false },
  );
  const availableTeams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () => availableProjectsOf(organization?.teams ?? []),
    [organization?.teams],
  );
  // The model picked in Spend by model, or null for every model. It
  // narrows the recent-activity list only, so it rides the same query and
  // leaves the totals, the chart and the model list themselves whole.
  const [usageModel, setUsageModel] = useState<string | null>(null);
  const usageWindow = useRollingWindow(30);
  const usageQuery = api.gatewayUsage.summaryForVirtualKey.useQuery(
    {
      organizationId: orgId,
      virtualKeyId: vkId,
      fromDate: usageWindow.fromIso,
      toDate: usageWindow.toIso,
      ...(usageModel ? { model: usageModel } : {}),
    },
    // Picking a model re-reads the same block, so holding the previous
    // answer keeps the chips and the chart on screen instead of replacing
    // the whole section with a spinner on every click.
    { enabled: !!orgId && !!vkId, placeholderData: keepPreviousData },
  );
  const utils = api.useUtils();
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () => utils.virtualKeys.get.invalidate({ organizationId: orgId, id: vkId }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () => utils.virtualKeys.get.invalidate({ organizationId: orgId, id: vkId }),
  });
  const disableMutation = api.virtualKeys.disable.useMutation({
    onSuccess: () => utils.virtualKeys.get.invalidate({ organizationId: orgId, id: vkId }),
  });
  const enableMutation = api.virtualKeys.enable.useMutation({
    onSuccess: () => utils.virtualKeys.get.invalidate({ organizationId: orgId, id: vkId }),
  });

  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [revealSecret, setRevealSecret] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  // Manual override for the model written into the "How to use" snippet.
  // Null until the user clicks a provider row in the eligible-MP preview;
  // otherwise the snippet model is derived from the key's first eligible
  // provider (see snippetModel below).
  const [snippetModelOverride, setSnippetModelOverride] = useState<string | null>(null);

  const canUpdate = hasPermission("virtualKeys:update");
  const canRotate = hasPermission("virtualKeys:rotate");
  const canAttachGuardrails = hasPermission("gatewayGuardrails:attach");

  const vk = detailQuery.data;

  // The model shown in the "How to use" snippet: the manual override wins,
  // else the key's first eligible provider in resolver-safe `vendor/model`
  // form (so a self-hosted / custom key shows `custom/<model>`, not the
  // OpenAI-only `gpt-5-mini`). `gpt-5-mini` is only the placeholder shown
  // before the eligible providers resolve.
  const computedDefaultModel = useMemo(
    () =>
      firstEligibleDefaultModel({
        scopes: vk?.scopes ?? [],
        providers: (orgProvidersQuery.data ?? []) as OrgModelProvider[],
        availableProjects,
        organizationId: orgId,
      }),
    [vk?.scopes, orgProvidersQuery.data, availableProjects, orgId],
  );
  const snippetModel = snippetModelOverride ?? computedDefaultModel ?? "gpt-5-mini";

  // Guardrails are project-scoped: only a VK reachable from exactly one
  // PROJECT scope has a single guardrail surface to edit.
  const guardrailProject = useMemo(
    () => guardrailProjectOf({ scopes: vk?.scopes ?? [], teams: organization?.teams ?? [] }),
    [vk?.scopes, organization?.teams],
  );

  const viewTracesHref = useMemo(
    () => tracesHrefFor({ vk, teams: organization?.teams ?? [] }),
    [vk, organization?.teams],
  );
  // The same link, narrowed to whatever the usage block is showing, so the
  // trace list opens on the requests the table underneath it lists.
  const usageTracesHref = useMemo(
    () => tracesHrefFor({ vk, teams: organization?.teams ?? [], model: usageModel }),
    [vk, organization?.teams, usageModel],
  );

  const routingPolicyName = routingPolicyQuery.data?.name ?? null;
  // The providers the pinned policy walks, so the panel can mark one the
  // key may hold but dispatch would never reach.
  const routingPolicyProviderIds = useMemo(
    () => stringIdsOf(routingPolicyQuery.data?.modelProviderIds),
    [routingPolicyQuery.data?.modelProviderIds],
  );
  const providersAllowed = useMemo(() => {
    const config = vk?.config as VkConfig | null | undefined;
    return config?.providersAllowed ?? null;
  }, [vk?.config]);

  const guardrailAttachments = useMemo(
    () =>
      ((vk?.config as { guardrailAttachments?: unknown } | null)?.guardrailAttachments ?? []) as {
        direction: "pre" | "post" | "stream_chunk";
        guardrailIds: string[];
      }[],
    [vk?.config],
  );

  const confirmRotate = () =>
    runKeyAction({
      vk,
      organizationId: orgId,
      action: async (vk, organizationId) => {
        const result = await rotateMutation.mutateAsync({
          organizationId,
          id: vk.id,
        });
        setRevealSecret({ name: vk.name, secret: result.secret });
        setRotating(false);
      },
      onFailure: (error) => showErrorToast({ error, fallbackTitle: "Couldn't rotate the key" }),
    });

  const confirmDisable = () =>
    runKeyAction({
      vk,
      organizationId: orgId,
      action: async (vk, organizationId) => {
        await disableMutation.mutateAsync({ organizationId, id: vk.id });
        setDisabling(false);
      },
      onFailure: (error) => showErrorToast({ error, fallbackTitle: "Couldn't disable the key" }),
    });

  const confirmEnable = () =>
    runKeyAction({
      vk,
      organizationId: orgId,
      action: async (vk, organizationId) => {
        await enableMutation.mutateAsync({ organizationId, id: vk.id });
      },
      onFailure: (error) => showErrorToast({ error, fallbackTitle: "Couldn't enable the key" }),
    });

  const confirmRevoke = () =>
    runKeyAction({
      vk,
      organizationId: orgId,
      action: async (vk, organizationId) => {
        await revokeMutation.mutateAsync({ organizationId, id: vk.id });
        setRevoking(false);
      },
      onFailure: (error) => showErrorToast({ error, fallbackTitle: "Couldn't revoke the key" }),
    });

  return (
    <AiGatewayLayout>
      <>
        <PageLayout.Header>
          <HStack>
            <Link href={`/gateway/virtual-keys`} color="fg.muted" fontSize="sm">
              <HStack gap={1}>
                <ArrowLeft size={14} /> Virtual Keys
              </HStack>
            </Link>
          </HStack>
          <PageLayout.Heading>{vk?.name ?? "Virtual key"}</PageLayout.Heading>
          <Spacer />
          {vk && (
            <VirtualKeyHeaderActions
              vk={vk}
              viewTracesHref={viewTracesHref}
              canUpdate={canUpdate}
              canRotate={canRotate}
              isEnabling={enableMutation.isPending}
              onEdit={() => setEditing(true)}
              onRotate={() => setRotating(true)}
              onDisable={() => setDisabling(true)}
              onEnable={() => void confirmEnable()}
              onRevoke={() => setRevoking(true)}
            />
          )}
        </PageLayout.Header>

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
          {detailQuery.isLoading && <Spinner />}
          {!detailQuery.isLoading && !vk && <Text color="fg.muted">Virtual key not found.</Text>}
          {!detailQuery.isLoading && vk && (
            <VStack align="stretch" gap={6} maxWidth="900px">
              <VirtualKeyIdentitySection vk={vk} />

              <VirtualKeyActivitySection vk={vk} />

              <Section title="How to use">
                <VirtualKeyUsageSnippet model={snippetModel} />
              </Section>

              <Section title="Scope & routing">
                <VStack align="stretch" gap={3}>
                  <VirtualKeyOwnershipReadOnly
                    scopes={(vk.scopes ?? []).map((s) => ({
                      scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
                      scopeId: s.scopeId,
                    }))}
                    principal={
                      vk.principalUserId && vk.principalUser
                        ? {
                            name: vk.principalUser.name,
                            email: vk.principalUser.email,
                          }
                        : undefined
                    }
                    traceProjectId={vk.traceProjectId ?? null}
                    traceProjectArchived={vk.traceProjectArchived ?? false}
                    viewTracesHref={viewTracesHref}
                    ctx={{
                      organizationName: organization?.name,
                      availableTeams,
                      availableProjects,
                    }}
                  />
                  <HStack>
                    <Text fontSize="sm" color="fg.muted">
                      Routing policy:
                    </Text>
                    <RoutingPolicyValue
                      routingPolicyId={vk.routingPolicyId}
                      routingPolicyName={routingPolicyName}
                    />
                  </HStack>
                  <EligibleModelProvidersSummary
                    scopes={vk.scopes ?? []}
                    organizationId={orgId}
                    organizationName={organization?.name}
                    availableTeams={availableTeams}
                    availableProjects={availableProjects}
                    isLoading={orgProvidersQuery.isLoading}
                    providers={orgProvidersQuery.data ?? []}
                    providersAllowed={providersAllowed}
                  />
                  <Box>
                    <HStack mb={1.5} alignItems="center" gap={2} justifyContent="space-between">
                      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                        Allowed model providers
                      </Text>
                      <ConfigureModelProvidersLink scopes={vk.scopes ?? []} />
                    </HStack>
                    <EligibleModelProvidersPreview
                      scopes={vk.scopes ?? []}
                      organizationId={orgId}
                      organizationName={organization?.name}
                      availableTeams={availableTeams}
                      availableProjects={availableProjects}
                      isLoading={orgProvidersQuery.isLoading}
                      providers={orgProvidersQuery.data ?? []}
                      providersAllowed={providersAllowed}
                      routingPolicyProviderIds={routingPolicyProviderIds}
                      selectedModel={snippetModel}
                      onSelectProviderModel={setSnippetModelOverride}
                    />
                  </Box>
                </VStack>
              </Section>

              <GuardrailAttachmentsSection
                organizationId={orgId}
                vkId={vk.id}
                projectId={guardrailProject?.id ?? null}
                projectSlug={guardrailProject?.slug ?? null}
                attachments={guardrailAttachments}
                canAttach={canAttachGuardrails}
                onSaved={() => void detailQuery.refetch()}
              />

              <ConfigurationSection config={vk.config as VkConfig | null} />

              <UsageSection
                data={usageQuery.data ?? null}
                selectedModel={usageModel}
                onSelectModel={setUsageModel}
                viewTracesHref={usageTracesHref}
              />
            </VStack>
          )}
        </Box>
      </>

      {orgId && vk && (
        <VirtualKeyEditDrawer
          organizationId={orgId}
          // The cast stands on one field: VirtualKeyCamelDto types `config`
          // as `unknown`, while the drawer names the config shape it reads.
          // Modelling the config JSON on the DTO is what removes this, and it
          // is a change to the wire type rather than to this call.
          vk={editing ? (vk as VirtualKeyDetail) : null}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
          onSaved={() => {
            setEditing(false);
            void detailQuery.refetch();
          }}
        />
      )}
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title={`Rotate ${vk?.name ?? "virtual key"}?`}
        message="A fresh secret will be minted and shown once. The current secret keeps working for 24h (grace window) so clients can roll over."
        confirmLabel="Rotate secret"
        tone="warning"
        loading={rotateMutation.isPending}
        onConfirm={confirmRotate}
      />
      <ConfirmDialog
        open={disabling}
        onOpenChange={setDisabling}
        title={`Disable ${vk?.name ?? "virtual key"}?`}
        message="Requests are rejected with a distinct disabled error within seconds. Everything about the key is preserved; enable restores it exactly as it was."
        confirmLabel="Disable key"
        tone="warning"
        loading={disableMutation.isPending}
        onConfirm={confirmDisable}
      />
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Revoke ${vk?.name ?? "virtual key"}?`}
        message="Clients using this key start receiving 401s within ~60 seconds. This cannot be undone: revoked keys are never reactivated."
        confirmLabel="Revoke key"
        tone="danger"
        loading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
      />
      <VirtualKeySecretReveal
        open={!!revealSecret}
        onClose={() => setRevealSecret(null)}
        keyName={revealSecret?.name ?? ""}
        secret={revealSecret?.secret ?? ""}
        model={snippetModel}
        kind="rotate"
      />
    </AiGatewayLayout>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  /** Rendered opposite the heading, for a section that leads somewhere. */
  action?: React.ReactNode;
}) {
  return (
    <Box>
      <HStack mb={2}>
        <Heading size="sm">{title}</Heading>
        <Spacer />
        {action}
      </HStack>
      <Separator mb={3} />
      <VStack align="stretch" gap={2}>
        {children}
      </VStack>
    </Box>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HStack gap={4} align="flex-start">
      <Text fontSize="sm" color="fg.muted" minWidth="140px">
        {label}
      </Text>
      {children}
    </HStack>
  );
}

type VkConfig = {
  modelAliases?: Record<string, string>;
  modelsAllowed?: string[] | null;
  /** Null or absent means every provider the key's scopes reach. */
  providersAllowed?: string[] | null;
  cache?: { mode?: "respect" | "force" | "disable"; ttlS?: number };
  rateLimits?: {
    rpm?: number | null;
    tpm?: number | null;
    rpd?: number | null;
  };
  policyRules?: {
    tools?: { deny?: string[]; allow?: string[] | null };
    mcp?: { deny?: string[]; allow?: string[] | null };
    urls?: { deny?: string[]; allow?: string[] | null };
    models?: { deny?: string[]; allow?: string[] | null };
  };
  guardrails?: {
    pre?: unknown[];
    post?: unknown[];
    streamChunk?: unknown[];
  };
  metadata?: { tags?: string[] };
};

type VkUsageData = {
  totalUsd: string;
  totalRequests: number;
  blockedRequests: number;
  avgUsdPerRequest: string;
  byModel: { model: string; totalUsd: string; requests: number }[];
  byDay: { day: string; totalUsd: string; requests: number }[];
  recentDebits: {
    id: string;
    occurredAt: string;
    model: string;
    providerSlot: string | null;
    amountUsd: string;
    tokensInput: number;
    tokensOutput: number;
    durationMs: number | null;
    status: string;
  }[];
};

function UsageSection({
  data,
  selectedModel,
  onSelectModel,
  viewTracesHref,
}: {
  data: VkUsageData | null;
  /** The model the chips have picked, or null for every model. */
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  viewTracesHref?: string;
}) {
  const action = viewTracesHref ? (
    <Link href={viewTracesHref}>
      <Button variant="outline" size="xs" data-testid="vk-usage-view-traces">
        <Bird size={14} /> View all traces
      </Button>
    </Link>
  ) : null;

  if (!data) {
    return (
      <Section title="Usage (last 30 days)" action={action}>
        <Spinner size="sm" />
      </Section>
    );
  }
  if (data.totalRequests === 0) {
    return (
      <Section title="Usage (last 30 days)" action={action}>
        <Text fontSize="sm" color="fg.muted">
          No usage in the last 30 days. Send a request through this virtual key and it'll show up
          here.
        </Text>
      </Section>
    );
  }
  const points = data.byDay.map((p) => ({
    day: p.day,
    spendUsd: Number(p.totalUsd),
    requests: p.requests,
  }));
  return (
    <Section title="Usage (last 30 days)" action={action}>
      <VStack align="stretch" gap={4}>
        <HStack gap={6} wrap="wrap">
          <VkStat label="Total spend" value={`$${Number(data.totalUsd).toFixed(2)}`} />
          <VkStat label="Requests" value={data.totalRequests.toLocaleString()} />
          <VkStat label="Avg $/request" value={formatVkAvgCost(data.avgUsdPerRequest)} />
          {data.blockedRequests > 0 && (
            <VkStat label="Blocked" value={data.blockedRequests.toLocaleString()} tone="red" />
          )}
        </HStack>
        {points.length >= 2 && (
          <Box
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="lg"
            padding={3}
            height="180px"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="vkSpendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickFormatter={(d: string) => d.slice(5)}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={56}
                />
                <RechartsTooltip
                  formatter={(value, name) =>
                    name === "spendUsd" ? [`$${Number(value).toFixed(4)}`, "Spend"] : [value, name]
                  }
                  labelFormatter={(label) => String(label ?? "")}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="spendUsd"
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#vkSpendFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        )}
        {data.byModel.length > 0 && (
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Spend by model
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {data.byModel.map((m) => {
                const isSelected = selectedModel === m.model;
                return (
                  <chakra.button
                    key={m.model}
                    type="button"
                    cursor="pointer"
                    data-testid={`vk-usage-model-${m.model}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectModel(isSelected ? null : m.model)}
                  >
                    <Badge
                      variant={isSelected ? "solid" : "outline"}
                      colorPalette={isSelected ? "orange" : undefined}
                      fontSize="2xs"
                    >
                      {m.model} · ${Number(m.totalUsd).toFixed(2)} · {m.requests}
                    </Badge>
                  </chakra.button>
                );
              })}
            </HStack>
          </VStack>
        )}
        {(data.recentDebits.length > 0 || selectedModel) && (
          <VStack align="stretch" gap={1}>
            <HStack gap={2}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Recent activity
              </Text>
              {selectedModel && (
                <Text fontSize="xs" color="fg.muted" data-testid="vk-usage-model-filter">
                  {selectedModel} only. Click the model again to see all.
                </Text>
              )}
            </HStack>
            {data.recentDebits.length === 0 ? (
              <Text fontSize="xs" color="fg.muted">
                No requests on that model in the last 30 days.
              </Text>
            ) : (
              <Table.Root size="sm" variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>When</Table.ColumnHeader>
                    <Table.ColumnHeader>Model</Table.ColumnHeader>
                    <Table.ColumnHeader>Tokens</Table.ColumnHeader>
                    <Table.ColumnHeader>Amount</Table.ColumnHeader>
                    <Table.ColumnHeader>Latency</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.recentDebits.slice(0, 10).map((d) => (
                    <Table.Row key={d.id}>
                      <Table.Cell>
                        <Tooltip content={readableDate(d.occurredAt).toLocaleString()}>
                          <Text fontSize="xs" color="fg.muted">
                            {formatTimeAgo(toEpochMs(d.occurredAt))}
                          </Text>
                        </Tooltip>
                      </Table.Cell>
                      <Table.Cell>
                        <Code fontSize="xs">{d.model}</Code>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs" color="fg.muted">
                          {d.tokensInput.toLocaleString()} → {d.tokensOutput.toLocaleString()}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs">{formatVkAmount(d.amountUsd)}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs" color="fg.muted">
                          {d.durationMs !== null ? `${d.durationMs}ms` : "—"}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </VStack>
        )}
      </VStack>
    </Section>
  );
}

function VkStat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="2xs" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="xl" fontWeight="semibold" color={tone === "red" ? "red.600" : undefined}>
        {value}
      </Text>
    </VStack>
  );
}

function formatVkAvgCost(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(6)}`;
}

function formatVkAmount(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(6)}`;
}

function ConfigurationSection({ config }: { config: VkConfig | null }) {
  if (!config) return null;

  const tags = config.metadata?.tags ?? [];
  const cacheMode = config.cache?.mode ?? "respect";
  const rpm = config.rateLimits?.rpm ?? null;
  const rpd = config.rateLimits?.rpd ?? null;
  const aliasCount = Object.keys(config.modelAliases ?? {}).length;

  const blockedCount = (["tools", "mcp", "urls", "models"] as const).reduce((sum, dim) => {
    const bp = config.policyRules?.[dim];
    return sum + (bp?.deny?.length ?? 0);
  }, 0);

  const guardrailCount =
    (config.guardrails?.pre?.length ?? 0) +
    (config.guardrails?.post?.length ?? 0) +
    (config.guardrails?.streamChunk?.length ?? 0);

  const cacheTone = cacheToneFor(cacheMode);

  return (
    <Section title="Configuration">
      {tags.length > 0 && (
        <DetailRow label="Tags">
          <HStack gap={1} flexWrap="wrap">
            {tags.map((t) => (
              <Badge key={t} variant="subtle" colorPalette="gray" fontSize="2xs">
                {t}
              </Badge>
            ))}
          </HStack>
        </DetailRow>
      )}
      <DetailRow label="Cache mode">
        <HStack gap={1}>
          <Badge colorPalette={cacheTone}>{cacheMode}</Badge>
          {cacheMode === "force" && (
            <Text fontSize="xs" color="fg.muted">
              ttl {config.cache?.ttlS ?? 3600}s
            </Text>
          )}
        </HStack>
      </DetailRow>
      <DetailRow label="Rate limits">
        <HStack gap={1} flexWrap="wrap">
          <Badge variant="outline" fontSize="2xs">
            rpm {rpm ?? "∞"}
          </Badge>
          <Badge variant="outline" fontSize="2xs">
            rpd {rpd ?? "∞"}
          </Badge>
        </HStack>
      </DetailRow>
      <DetailRow label="Model aliases">
        {aliasCount === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            —
          </Text>
        ) : (
          <VStack align="start" gap={1}>
            {Object.entries(config.modelAliases ?? {})
              .slice(0, 5)
              .map(([alias, target]) => (
                <HStack key={alias} gap={1} fontSize="xs">
                  <Code fontSize="xs">{alias}</Code>
                  <Text color="fg.muted">→</Text>
                  <Code fontSize="xs">{target}</Code>
                </HStack>
              ))}
            {aliasCount > 5 && (
              <Text fontSize="xs" color="fg.muted">
                + {aliasCount - 5} more (see Edit drawer)
              </Text>
            )}
          </VStack>
        )}
      </DetailRow>
      <DetailRow label="Policy rules">
        {blockedCount === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            —
          </Text>
        ) : (
          <VStack align="start" gap={1}>
            {(["tools", "mcp", "urls", "models"] as const).map((dim) => {
              const deny = config.policyRules?.[dim]?.deny ?? [];
              if (deny.length === 0) return null;
              return (
                <HStack key={dim} gap={1} flexWrap="wrap" fontSize="xs">
                  <Text fontWeight="medium" minWidth="48px">
                    {dim}:
                  </Text>
                  {deny.slice(0, 4).map((pattern) => (
                    <Code key={pattern} fontSize="2xs" colorPalette="red">
                      {pattern}
                    </Code>
                  ))}
                  {deny.length > 4 && <Text color="fg.muted">+ {deny.length - 4} more</Text>}
                </HStack>
              );
            })}
          </VStack>
        )}
      </DetailRow>
      <DetailRow label="Guardrails">
        <Text fontSize="sm" color={guardrailCount > 0 ? undefined : "fg.muted"}>
          {guardrailCount > 0
            ? `${guardrailCount} monitor${guardrailCount > 1 ? "s" : ""} attached (pre/post/stream_chunk)`
            : "—"}
        </Text>
      </DetailRow>
    </Section>
  );
}

export default VirtualKeyDetailPage;

function statusPalette(vk: {
  status: string;
  expiresAt: Parameters<typeof isExpired>[0];
}): "red" | "yellow" | "orange" | "green" {
  if (vk.status === "revoked") return "red";
  if (vk.status === "disabled") return "yellow";
  if (isExpired(vk.expiresAt)) return "orange";
  return "green";
}

// The name when the reader may read policies, the stored identifier when they
// may not: this page opens on a weaker permission than the policy needs, and
// an identifier is still better than an empty row.
function RoutingPolicyValue({
  routingPolicyId,
  routingPolicyName,
}: {
  routingPolicyId: string | null;
  routingPolicyName: string | null;
}) {
  if (!routingPolicyId) {
    return (
      <Text fontSize="sm" color="fg.muted">
        default cascade, all eligible providers in priority order
      </Text>
    );
  }
  if (routingPolicyName) {
    return (
      <Link
        href={`/gateway/routing-policies?drawer.open=routingPolicy&drawer.policyId=${routingPolicyId}`}
        color="blue.600"
        fontSize="sm"
        data-testid="vk-routing-policy-link"
      >
        {routingPolicyName}
      </Link>
    );
  }
  return (
    <Code fontSize="xs" data-testid="vk-routing-policy-id">
      {routingPolicyId}
    </Code>
  );
}

function cacheToneFor(cacheMode: "respect" | "force" | "disable"): "orange" | "red" | "green" {
  if (cacheMode === "force") return "orange";
  if (cacheMode === "disable") return "red";
  return "green";
}

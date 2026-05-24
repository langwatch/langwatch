import {
  Badge,
  Box,
  Button,
  Code,
  HStack,
  Heading,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, FileClock, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import {
  ConfigureModelProvidersLink,
  EligibleModelProvidersPreview,
  EligibleModelProvidersSummary,
} from "~/components/gateway/EligibleModelProvidersPreview";
import { FieldInfoTooltip } from "~/components/gateway/FieldInfoTooltip";
import { GuardrailAttachmentsSection } from "~/components/gateway/GuardrailAttachmentsSection";
import { VirtualKeyEditDrawer } from "~/components/gateway/VirtualKeyEditDrawer";
import { VirtualKeySecretReveal } from "~/components/gateway/VirtualKeySecretReveal";
import { VirtualKeyUsageSnippet } from "~/components/gateway/VirtualKeyUsageSnippet";
import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import { Link } from "~/components/ui/link";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

function VirtualKeyDetailPage() {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const vkId = typeof router.query.id === "string" ? router.query.id : "";
  const orgId = organization?.id ?? "";

  const detailQuery = api.virtualKeys.get.useQuery(
    { organizationId: orgId, id: vkId },
    { enabled: !!orgId && !!vkId },
  );
  const orgProvidersQuery =
    api.modelProvider.listAllForOrganizationForFrontend.useQuery(
      { organizationId: orgId },
      { enabled: !!orgId },
    );
  const availableTeams = useMemo(
    () =>
      organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () =>
      organization?.teams?.flatMap((t) =>
        t.projects.map((p) => ({
          id: p.id,
          name: `${p.name} · ${t.name}`,
          teamId: t.id,
        })),
      ) ?? [],
    [organization?.teams],
  );
  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of organization?.teams ?? []) map.set(t.id, t.name);
    return map;
  }, [organization?.teams]);
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of organization?.teams ?? []) {
      for (const p of t.projects) map.set(p.id, p.name);
    }
    return map;
  }, [organization?.teams]);
  const usageWindow = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }, []);
  const usageQuery = api.gatewayUsage.summaryForVirtualKey.useQuery(
    {
      projectId: project?.id ?? "",
      virtualKeyId: vkId,
      fromDate: usageWindow.fromDate,
      toDate: usageWindow.toDate,
    },
    { enabled: !!project?.id && !!vkId },
  );
  const utils = api.useContext();
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () =>
      utils.virtualKeys.get.invalidate({ organizationId: orgId, id: vkId }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () =>
      utils.virtualKeys.get.invalidate({ organizationId: orgId, id: vkId }),
  });

  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revealSecret, setRevealSecret] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  // Drives the model name written into the "How to use" snippet. Starts
  // at the bare OpenAI-SDK default; clicking a provider row in the
  // eligible-MP preview rewrites this to `${vendor}/${defaultModel}` so
  // the copy-pasteable example points at a model the VK can actually
  // serve through that provider.
  const [snippetModel, setSnippetModel] = useState<string>("gpt-5-mini");

  const canUpdate = hasPermission("virtualKeys:update");
  const canRotate = hasPermission("virtualKeys:rotate");
  const canAttachGuardrails = hasPermission("gatewayGuardrails:attach");

  const vk = detailQuery.data;

  // Guardrails are project-scoped: only a VK reachable from exactly one
  // PROJECT scope has a single guardrail surface to edit.
  const guardrailProject = useMemo(() => {
    const projectScopes = (vk?.scopes ?? []).filter(
      (s) => s.scopeType === "PROJECT",
    );
    if (projectScopes.length !== 1) return null;
    const id = projectScopes[0]!.scopeId;
    for (const t of organization?.teams ?? []) {
      const p = t.projects.find((proj) => proj.id === id);
      if (p) return { id: p.id, slug: p.slug };
    }
    return { id, slug: null as string | null };
  }, [vk?.scopes, organization?.teams]);

  const guardrailAttachments = useMemo(
    () =>
      ((vk?.config as { guardrailAttachments?: unknown } | null)
        ?.guardrailAttachments ?? []) as Array<{
        direction: "pre" | "post" | "stream_chunk";
        guardrailIds: string[];
      }>,
    [vk?.config],
  );

  const confirmRotate = async () => {
    if (!vk || !orgId) return;
    try {
      const result = await rotateMutation.mutateAsync({
        organizationId: orgId,
        id: vk.id,
      });
      setRevealSecret({ name: vk.name, secret: result.secret });
      setRotating(false);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to rotate key",
        type: "error",
      });
    }
  };

  const confirmRevoke = async () => {
    if (!vk || !orgId) return;
    try {
      await revokeMutation.mutateAsync({ organizationId: orgId, id: vk.id });
      setRevoking(false);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to revoke key",
        type: "error",
      });
    }
  };

  return (
    <AiGatewayLayout>
      <>
        <PageLayout.Header>
          <HStack>
            <Link
              href={`/settings/gateway/virtual-keys`}
              color="fg.muted"
              fontSize="sm"
            >
              <HStack gap={1}>
                <ArrowLeft size={14} /> Virtual Keys
              </HStack>
            </Link>
          </HStack>
          <PageLayout.Heading>{vk?.name ?? "Virtual key"}</PageLayout.Heading>
          <Spacer />
          {vk && (
            <HStack>
              {/* Audit history stays available even when revoked —
                  operators forensically investigating a revoked VK
                  still need its create/update/rotate/revoke trail. */}
              <Link
                href={`/settings/audit-log?targetKind=virtual_key&targetId=${vk.id}`}
              >
                <Button variant="outline" size="sm">
                  <FileClock size={14} /> Audit history
                </Button>
              </Link>
              {vk.status === "active" && canUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} /> Edit
                </Button>
              )}
              {vk.status === "active" && canRotate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRotating(true)}
                >
                  <RotateCw size={14} /> Rotate
                </Button>
              )}
              {vk.status === "active" && canUpdate && (
                <Button
                  colorPalette="red"
                  variant="outline"
                  size="sm"
                  onClick={() => setRevoking(true)}
                >
                  <Trash2 size={14} /> Revoke
                </Button>
              )}
            </HStack>
          )}
        </PageLayout.Header>

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
          {detailQuery.isLoading ? (
            <Spinner />
          ) : !vk ? (
            <Text color="fg.muted">Virtual key not found.</Text>
          ) : (
            <VStack align="stretch" gap={6} maxWidth="900px">
              <Section title="Identity">
                <DetailRow label="Prefix">
                  <HStack gap={1}>
                    <Code fontSize="xs">{vk.displayPrefix}…</Code>
                    <FieldInfoTooltip description="First chars of the secret. The full secret is shown only once at create or rotate — if it's lost, rotate the key to mint a fresh one." />
                  </HStack>
                </DetailRow>
                <DetailRow label="Status">
                  <Badge
                    colorPalette={vk.status === "active" ? "green" : "red"}
                  >
                    {vk.status}
                  </Badge>
                </DetailRow>
                {vk.description && (
                  <DetailRow label="Description">
                    <Text fontSize="sm">{vk.description}</Text>
                  </DetailRow>
                )}
              </Section>

              <Section title="Activity">
                <DetailRow label="Last used">
                  {vk.lastUsedAt ? (
                    <Tooltip content={new Date(vk.lastUsedAt).toLocaleString()}>
                      <Text fontSize="sm" color="fg.muted">
                        {formatTimeAgo(new Date(vk.lastUsedAt).getTime())}
                      </Text>
                    </Tooltip>
                  ) : (
                    <Text fontSize="sm" color="fg.muted">
                      never
                    </Text>
                  )}
                </DetailRow>
                <DetailRow label="Created">
                  <Tooltip content={new Date(vk.createdAt).toLocaleString()}>
                    <Text fontSize="sm" color="fg.muted">
                      {formatTimeAgo(new Date(vk.createdAt).getTime())}
                    </Text>
                  </Tooltip>
                </DetailRow>
                <DetailRow label="Revision">
                  <Text fontSize="sm" color="fg.muted">
                    {vk.revision}
                  </Text>
                </DetailRow>
              </Section>

              <Section title="How to use">
                <VirtualKeyUsageSnippet model={snippetModel} />
              </Section>

              <Section title="Scope & routing">
                <VStack align="stretch" gap={3}>
                  <ProviderScopeChips
                    scopes={(vk.scopes ?? []).map((s) => ({
                      scopeType: s.scopeType as
                        | "ORGANIZATION"
                        | "TEAM"
                        | "PROJECT",
                      scopeId: s.scopeId,
                      name:
                        s.scopeType === "ORGANIZATION"
                          ? organization?.name
                          : s.scopeType === "TEAM"
                            ? teamNameById.get(s.scopeId)
                            : projectNameById.get(s.scopeId),
                    }))}
                    principal={
                      vk.principalUserId && vk.principalUser
                        ? {
                            name: vk.principalUser.name,
                            email: vk.principalUser.email,
                          }
                        : undefined
                    }
                  />
                  <HStack>
                    <Text fontSize="sm" color="fg.muted">
                      Routing policy:
                    </Text>
                    {vk.routingPolicyId ? (
                      <Code fontSize="xs">{vk.routingPolicyId}</Code>
                    ) : (
                      <Text fontSize="sm" color="fg.muted">
                        default cascade — all eligible providers in priority
                        order
                      </Text>
                    )}
                  </HStack>
                  <EligibleModelProvidersSummary
                    scopes={vk.scopes ?? []}
                    organizationId={orgId}
                    organizationName={organization?.name}
                    availableTeams={availableTeams}
                    availableProjects={availableProjects}
                    isLoading={orgProvidersQuery.isLoading}
                    providers={
                      (orgProvidersQuery.data?.providers ?? []) as any
                    }
                  />
                  <Box>
                    <HStack
                      mb={1.5}
                      alignItems="center"
                      gap={2}
                      justifyContent="space-between"
                    >
                      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                        Eligible model providers
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
                      providers={
                        (orgProvidersQuery.data?.providers ?? []) as any
                      }
                      selectedModel={snippetModel}
                      onSelectProviderModel={setSnippetModel}
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

              <UsageSection data={usageQuery.data ?? null} />

            </VStack>
          )}
        </Box>
      </>

      {orgId && vk && (
        <VirtualKeyEditDrawer
          organizationId={orgId}
          vk={editing ? (vk as any) : null}
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
        open={revoking}
        onOpenChange={setRevoking}
        title={`Revoke ${vk?.name ?? "virtual key"}?`}
        message="Clients using this key start receiving 401s within ~60 seconds. This cannot be undone — revoked keys are never reactivated."
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
        kind="rotate"
      />
    </AiGatewayLayout>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Heading size="sm" mb={2}>
        {title}
      </Heading>
      <Separator mb={3} />
      <VStack align="stretch" gap={2}>
        {children}
      </VStack>
    </Box>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
  cache?: { mode?: "respect" | "force" | "disable"; ttlS?: number };
  rateLimits?: { rpm?: number | null; tpm?: number | null; rpd?: number | null };
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
  byModel: Array<{ model: string; totalUsd: string; requests: number }>;
  byDay: Array<{ day: string; totalUsd: string; requests: number }>;
  recentDebits: Array<{
    id: string;
    occurredAt: string;
    model: string;
    providerSlot: string | null;
    amountUsd: string;
    tokensInput: number;
    tokensOutput: number;
    durationMs: number | null;
    status: string;
  }>;
};

function UsageSection({ data }: { data: VkUsageData | null }) {
  if (!data) {
    return (
      <Section title="Usage (last 30 days)">
        <Spinner size="sm" />
      </Section>
    );
  }
  if (data.totalRequests === 0) {
    return (
      <Section title="Usage (last 30 days)">
        <Text fontSize="sm" color="fg.muted">
          No usage in the last 30 days. Send a request through this
          virtual key and it'll show up here.
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
    <Section title="Usage (last 30 days)">
      <VStack align="stretch" gap={4}>
        <HStack gap={6} wrap="wrap">
          <VkStat label="Total spend" value={`$${Number(data.totalUsd).toFixed(2)}`} />
          <VkStat label="Requests" value={data.totalRequests.toLocaleString()} />
          <VkStat
            label="Avg $/request"
            value={formatVkAvgCost(data.avgUsdPerRequest)}
          />
          {data.blockedRequests > 0 && (
            <VkStat
              label="Blocked"
              value={data.blockedRequests.toLocaleString()}
              tone="red"
            />
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
              <AreaChart
                data={points}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
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
                    name === "spendUsd"
                      ? [`$${Number(value).toFixed(4)}`, "Spend"]
                      : [value, name]
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
              {data.byModel.map((m) => (
                <Badge key={m.model} variant="outline" fontSize="2xs">
                  {m.model} · ${Number(m.totalUsd).toFixed(2)} · {m.requests}
                </Badge>
              ))}
            </HStack>
          </VStack>
        )}
        {data.recentDebits.length > 0 && (
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Recent activity
            </Text>
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
                      <Tooltip content={new Date(d.occurredAt).toLocaleString()}>
                        <Text fontSize="xs" color="fg.muted">
                          {formatTimeAgo(new Date(d.occurredAt).getTime())}
                        </Text>
                      </Tooltip>
                    </Table.Cell>
                    <Table.Cell>
                      <Code fontSize="xs">{d.model}</Code>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="xs" color="fg.muted">
                        {d.tokensInput.toLocaleString()} →{" "}
                        {d.tokensOutput.toLocaleString()}
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
          </VStack>
        )}
      </VStack>
    </Section>
  );
}

function VkStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red";
}) {
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

  const blockedCount = (["tools", "mcp", "urls", "models"] as const).reduce(
    (sum, dim) => {
      const bp = config.policyRules?.[dim];
      return sum + (bp?.deny?.length ?? 0);
    },
    0,
  );

  const guardrailCount =
    (config.guardrails?.pre?.length ?? 0) +
    (config.guardrails?.post?.length ?? 0) +
    (config.guardrails?.streamChunk?.length ?? 0);

  const cacheTone =
    cacheMode === "force" ? "orange" : cacheMode === "disable" ? "red" : "green";

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
                  {deny.length > 4 && (
                    <Text color="fg.muted">+ {deny.length - 4} more</Text>
                  )}
                </HStack>
              );
            })}
          </VStack>
        )}
      </DetailRow>
      <DetailRow label="Guardrails">
        <Text
          fontSize="sm"
          color={guardrailCount > 0 ? undefined : "fg.muted"}
        >
          {guardrailCount > 0
            ? `${guardrailCount} monitor${guardrailCount > 1 ? "s" : ""} attached (pre/post/stream_chunk)`
            : "—"}
        </Text>
      </DetailRow>
    </Section>
  );
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: AiGatewayLayout,
})(VirtualKeyDetailPage);

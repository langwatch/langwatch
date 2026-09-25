import {
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  HStack,
  Spacer,
  Spinner,
  Table,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ProviderScopeChips } from "@langwatch/authz-browser-kit";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatBudgetUsd, type VirtualKeySpendThisMonth } from "@langwatch/gateway-contract";
import { toEpochMs } from "@langwatch/time";
import {
  Ban,
  Bird,
  Eye,
  Gauge,
  KeyRound,
  LineChart,
  MoreVertical,
  Pencil,
  Plus,
  RotateCw,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../behavior/gateway-api.ts";
import { useShowErrorToast } from "../../../behavior/gateway-feedback.ts";
import { useGatewayRouter } from "../../../behavior/gateway-router.ts";
import { useOrganizationTeamProject } from "../../../behavior/gateway-session.ts";
import { resolveTracesHrefForKey } from "../../../features/virtual-keys/model/traces-href-for-key.ts";
import { isExpired } from "../../../features/virtual-keys/model/virtual-key-expiration.ts";
import {
  VirtualKeyBudgetBar,
  type VirtualKeyBudgetBarValue,
} from "../../../features/virtual-keys/ui/elements/virtual-key-budget-bar.tsx";
import { VirtualKeyCreateDrawer } from "../../../features/virtual-keys/ui/sections/virtual-key-create-drawer.tsx";
import {
  type VirtualKeyDetail,
  VirtualKeyEditDrawer,
} from "../../../features/virtual-keys/ui/sections/virtual-key-edit-drawer.tsx";
import { VirtualKeySecretReveal } from "../../../features/virtual-keys/ui/sections/virtual-key-secret-reveal.tsx";
import type { GatewayTeam } from "../../../model/gateway-host.ts";
import { readableDate } from "../../../model/readable-date.ts";
import { GatewayErrorPanel } from "../../../ui/elements/gateway-error-panel.tsx";
import { Link } from "../../../ui/elements/gateway-link.tsx";
import AiGatewayLayout from "../../../ui/sections/gateway-layout.tsx";

/** Deep link from a key's spend to its Usage view over the same window. */
function usageHrefForKey(virtualKeyId: string): string {
  return `/gateway/usage?vk=${virtualKeyId}&days=mtd`;
}

/**
 * What the status column says, which is not always what the column stores. Expiry is a date on
 * an ACTIVE key rather than a status value, so the badge derives it.
 */
function statusBadge(vk: { status: string; expiresAt?: string | null }): {
  label: string;
  colorPalette: string;
} {
  if (vk.status === "revoked") return { label: "revoked", colorPalette: "red" };
  if (vk.status === "disabled") return { label: "disabled", colorPalette: "yellow" };
  if (isExpired(vk.expiresAt)) {
    return { label: "expired", colorPalette: "orange" };
  }
  return { label: "active", colorPalette: "green" };
}

type ScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

type CreatedSecret = {
  id: string;
  name: string;
  secret: string;
  // Resolver-safe `vendor/model` example for the reveal snippet, computed
  // from the key's eligible providers at create time. Undefined for
  // list-page rotations, where the snippet falls back to its default.
  model?: string;
  // Differentiates mint flow (initial creation) from rotate — the
  // reveal dialog adds a 24h-grace banner on rotations.
  kind: "create" | "rotate";
};

function VirtualKeysPage() {
  const showErrorToast = useShowErrorToast();
  const { organization, hasPermission } = useOrganizationTeamProject();
  const router = useGatewayRouter();
  const canCreate = hasPermission("virtualKeys:create");
  const canRotate = hasPermission("virtualKeys:rotate");
  const canRevoke = hasPermission("virtualKeys:delete");
  const canUpdate = hasPermission("virtualKeys:update");

  const utils = api.useUtils();
  const orgId = organization?.id ?? "";
  const listQuery = api.virtualKeys.list.useQuery({ organizationId: orgId }, { enabled: !!orgId });
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );
  // Current-calendar-month spend per visible key, read from the same cost path the Usage tab
  // reads. The click-through deep-links Usage's "This month" preset, the same UTC month-to-date
  // window this column is computed over, so both surfaces show the same total. On a fetch error
  // the cell shows n/a: an unread ledger must not render as a confident $0.00.
  const spendQuery = api.virtualKeys.spendThisMonth.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );
  const { spendByKeyId, budgetByKeyId } = useMemo(
    () => indexSpendRows(spendQuery.data ?? []),
    [spendQuery.data],
  );
  const policyNameById = useMemo(
    () => new Map((policiesQuery.data ?? []).map((policy) => [policy.id, policy.name])),
    [policiesQuery.data],
  );
  const { teamNameById, projectNameById } = useMemo(
    () => indexScopeNames(organization?.teams ?? []),
    [organization?.teams],
  );
  const scopeEntriesWithNames = (scopes: ScopeEntry[]) =>
    scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      name: scopeDisplayName({
        scope: s,
        organizationName: organization?.name,
        teamNameById,
        projectNameById,
      }),
    }));
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () => utils.virtualKeys.list.invalidate({ organizationId: orgId }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () => utils.virtualKeys.list.invalidate({ organizationId: orgId }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [revealSecret, setRevealSecret] = useState<CreatedSecret | null>(null);
  const [editing, setEditing] = useState<VirtualKeyDetail | null>(null);
  const [rotating, setRotating] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [statusTab, setStatusTab] = useState<"active" | "revoked">("active");

  const allRows = listQuery.data ?? [];
  // A disabled key belongs with the live ones: it is paused, not finished,
  // and it used to appear in neither tab, which left the only route to it a
  // link somebody had kept. Revoked is the one terminal state, so it keeps
  // its own tab.
  const activeRows = useMemo(() => allRows.filter((vk) => vk.status !== "revoked"), [allRows]);
  const revokedRows = useMemo(() => allRows.filter((vk) => vk.status === "revoked"), [allRows]);
  const rows = statusTab === "active" ? activeRows : revokedRows;
  const listView = resolveListView({
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    rowCount: allRows.length,
  });

  // Keys whose traces can actually be opened. A key missing from this map
  // gets no "View traces" action, because the link would only lead to a
  // bounce or to a project that no longer serves anything.
  const traceHrefByKeyId = useMemo(
    () => traceHrefsByKeyId({ rows: allRows, teams: organization?.teams ?? [] }),
    [allRows, organization?.teams],
  );

  const confirmRotate = async () => {
    if (!rotating || !orgId) return;
    await rotateAndReveal({
      rotate: rotateMutation.mutateAsync,
      organizationId: orgId,
      key: rotating,
      onRotated: (secret) => {
        setRevealSecret(secret);
        setRotating(null);
      },
      onFailure: (error) => showErrorToast({ error, fallbackTitle: "Couldn't rotate the key" }),
    });
  };

  const confirmRevoke = async () => {
    if (!revoking || !orgId) return;
    try {
      await revokeMutation.mutateAsync({
        organizationId: orgId,
        id: revoking.id,
      });
      setRevoking(null);
    } catch (err) {
      showErrorToast({ error: err, fallbackTitle: "Couldn't revoke the key" });
    }
  };

  return (
    <AiGatewayLayout>
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Virtual Keys</PageLayout.Heading>
          <Spacer />
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New virtual key
            </Button>
          )}
        </PageLayout.Header>

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
          {listView === "loading" && <Spinner />}
          {listView === "error" && (
            <GatewayErrorPanel
              title="Failed to load virtual keys"
              error={listQuery.error}
              onRetry={() => listQuery.refetch()}
            />
          )}
          {listView === "empty" && (
            <VirtualKeysEmptyState canCreate={canCreate} onCreate={() => setCreateOpen(true)} />
          )}
          {listView === "list" && (
            <VStack align="stretch" gap={3} width="full">
              {revokedRows.length > 0 && (
                <Tabs.Root
                  value={statusTab}
                  onValueChange={(d) => setStatusTab(d.value as "active" | "revoked")}
                  variant="line"
                  size="sm"
                  colorPalette="blue"
                >
                  <Tabs.List>
                    <Tabs.Trigger value="active">
                      Active
                      <Badge variant="subtle" colorPalette="gray" ml={1.5}>
                        {activeRows.length}
                      </Badge>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="revoked">
                      Revoked
                      <Badge variant="subtle" colorPalette="gray" ml={1.5}>
                        {revokedRows.length}
                      </Badge>
                    </Tabs.Trigger>
                  </Tabs.List>
                </Tabs.Root>
              )}
              {rows.length === 0 ? (
                <Card.Root width="full">
                  <Card.Body>
                    <Text fontSize="sm" color="fg.muted" textAlign="center" py={6}>
                      No {statusTab} keys.
                    </Text>
                  </Card.Body>
                </Card.Root>
              ) : (
                <Card.Root width="full" overflow="hidden">
                  {/* The card clips; the body scrolls. Without this the
                      right-hand columns are simply unreachable on a narrow
                      window instead of scrolling into view. Focusable so the
                      scroll is reachable from the keyboard alone. */}
                  <Card.Body
                    paddingY={0}
                    paddingX={0}
                    overflowX="auto"
                    as="section"
                    tabIndex={0}
                    aria-label="Virtual keys table"
                  >
                    <Table.Root variant="line" size="md" width="full">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Name</Table.ColumnHeader>
                          <Table.ColumnHeader>Prefix</Table.ColumnHeader>
                          <Table.ColumnHeader>Status</Table.ColumnHeader>
                          <Table.ColumnHeader>Scopes</Table.ColumnHeader>
                          <Table.ColumnHeader>Routing</Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <Tooltip content="Spend this calendar month, from the same cost data the Usage tab shows. Click a value to open Usage filtered to that key.">
                              <Text as="span">Spent this month</Text>
                            </Tooltip>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Last used</Table.ColumnHeader>
                          <Table.ColumnHeader></Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {rows.map((vk) => (
                          <VirtualKeyTableRow
                            key={vk.id}
                            vk={vk}
                            scopes={scopeEntriesWithNames(vk.scopes)}
                            policyNameById={policyNameById}
                            spend={spendByKeyId.get(vk.id)}
                            spendIsLoading={spendQuery.isLoading}
                            spendIsError={spendQuery.isError}
                            budget={budgetByKeyId.get(vk.id)}
                            traceHref={traceHrefByKeyId.get(vk.id)}
                            canUpdate={canUpdate}
                            canRotate={canRotate}
                            canRevoke={canRevoke}
                            onNavigate={(href) => router.push(href)}
                            onEdit={() => setEditing(vk)}
                            onRotate={() => setRotating({ id: vk.id, name: vk.name })}
                            onRevoke={() => setRevoking({ id: vk.id, name: vk.name })}
                          />
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Card.Body>
                </Card.Root>
              )}
            </VStack>
          )}
        </Box>
      </>

      {orgId && (
        <VirtualKeyCreateDrawer
          organizationId={orgId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(created) => setRevealSecret({ ...created, kind: "create" })}
        />
      )}
      <VirtualKeySecretReveal
        open={!!revealSecret}
        onClose={() => setRevealSecret(null)}
        keyName={revealSecret?.name ?? ""}
        secret={revealSecret?.secret ?? ""}
        model={revealSecret?.model}
        kind={revealSecret?.kind ?? "create"}
      />
      {orgId && (
        <VirtualKeyEditDrawer
          organizationId={orgId}
          vk={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            void listQuery.refetch();
          }}
        />
      )}
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(open) => {
          if (!open) setRotating(null);
        }}
        title={`Rotate ${rotating?.name ?? "virtual key"}?`}
        message="A fresh secret will be minted and shown once. The current secret keeps working for 24h (grace window) so clients can roll over."
        confirmLabel="Rotate secret"
        tone="warning"
        loading={rotateMutation.isPending}
        onConfirm={confirmRotate}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={`Revoke ${revoking?.name ?? "virtual key"}?`}
        message="Clients using this key start receiving 401s within ~60 seconds. This cannot be undone: revoked keys are never reactivated."
        confirmLabel="Revoke key"
        tone="danger"
        loading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
      />
    </AiGatewayLayout>
  );
}

function VirtualKeyTableRow({
  vk,
  scopes,
  policyNameById,
  spend,
  spendIsLoading,
  spendIsError,
  budget,
  traceHref,
  canUpdate,
  canRotate,
  canRevoke,
  onNavigate,
  onEdit,
  onRotate,
  onRevoke,
}: {
  vk: VirtualKeyDetail;
  scopes: Parameters<typeof ProviderScopeChips>[0]["scopes"];
  policyNameById: Map<string, string>;
  spend: string | undefined;
  spendIsLoading: boolean;
  spendIsError: boolean;
  budget: VirtualKeyBudgetBarValue | undefined;
  traceHref: string | undefined;
  canUpdate: boolean;
  canRotate: boolean;
  canRevoke: boolean;
  onNavigate: (href: string) => void;
  onEdit: () => void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  return (
    <Table.Row
      cursor="pointer"
      _hover={{ bg: "bg.subtle" }}
      onClick={() => onNavigate(`/gateway/virtual-keys/${vk.id}`)}
    >
      <Table.Cell>
        <VStack align="start" gap={1}>
          <HStack gap={2} align="center">
            <Link href={`/gateway/virtual-keys/${vk.id}`} fontWeight="medium">
              {vk.name}
            </Link>
          </HStack>
          {vk.description && (
            <Text fontSize="xs" color="fg.muted">
              {vk.description}
            </Text>
          )}
          {(() => {
            const tags =
              (
                vk.config as {
                  metadata?: { tags?: string[] };
                }
              )?.metadata?.tags ?? [];
            if (tags.length === 0) return null;
            return (
              <HStack gap={1} flexWrap="wrap">
                {tags.map((t) => (
                  <Badge key={t} variant="subtle" colorPalette="gray" fontSize="2xs">
                    {t}
                  </Badge>
                ))}
              </HStack>
            );
          })()}
        </VStack>
      </Table.Cell>
      <Table.Cell>
        <Text fontFamily="mono" fontSize="xs">
          {vk.displayPrefix}…
        </Text>
      </Table.Cell>
      <Table.Cell>
        {(() => {
          const badge = statusBadge(vk);
          return (
            <Badge colorPalette={badge.colorPalette} data-testid={`vk-status-${vk.id}`}>
              {badge.label}
            </Badge>
          );
        })()}
      </Table.Cell>
      <Table.Cell>
        <ProviderScopeChips
          scopes={scopes}
          size="xs"
          principal={
            vk.principalUserId && vk.principalUser
              ? {
                  name: vk.principalUser.name,
                  email: vk.principalUser.email,
                }
              : undefined
          }
        />
      </Table.Cell>
      <Table.Cell>
        <RoutingPolicyCell
          routingPolicyId={vk.routingPolicyId}
          routingMode={vk.routingMode}
          policyNameById={policyNameById}
        />
      </Table.Cell>
      <Table.Cell onClick={(e) => e.stopPropagation()} cursor="default" minWidth="140px">
        <VStack align="stretch" gap={1.5} width="full">
          <Link
            className="group"
            href={usageHrefForKey(vk.id)}
            data-testid={`vk-spend-${vk.id}`}
            aria-label={`Usage for ${vk.name}, this month`}
            width="full"
          >
            <HStack gap={1} justify="space-between" width="full">
              <Text
                fontSize="sm"
                fontVariantNumeric="tabular-nums"
                color={spendTone(spend)}
                _groupHover={{
                  textDecoration: "underline",
                }}
              >
                {spendLabel({
                  isLoading: spendIsLoading,
                  isError: spendIsError,
                  spend,
                })}
              </Text>
              <Box
                as="span"
                data-testid={`vk-spend-chart-${vk.id}`}
                color="fg.muted"
                aria-hidden
                _groupHover={{ color: "fg" }}
              >
                <LineChart size={14} />
              </Box>
            </HStack>
          </Link>
          <VirtualKeyBudgetBar value={budget} virtualKeyId={vk.id} />
        </VStack>
      </Table.Cell>
      <Table.Cell>
        {vk.lastUsedAt ? (
          <Tooltip content={readableDate(vk.lastUsedAt).toLocaleString()}>
            <Text fontSize="sm">{formatTimeAgo(toEpochMs(vk.lastUsedAt))}</Text>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            never
          </Text>
        )}
      </Table.Cell>
      <Table.Cell onClick={(e) => e.stopPropagation()} cursor="default">
        {vk.status !== "revoked" && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost" size="xs" aria-label="Actions">
                <MoreVertical size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item
                value="details"
                onClick={() => onNavigate(`/gateway/virtual-keys/${vk.id}`)}
              >
                <Eye size={14} /> Details
              </Menu.Item>
              {traceHref && (
                <Menu.Item
                  value="view-traces"
                  data-testid={`vk-view-traces-${vk.id}`}
                  onClick={() => onNavigate(traceHref)}
                >
                  <Bird size={14} /> View traces
                </Menu.Item>
              )}
              {/* Editing and rotating a paused key
                  would take effect the moment it is
                  enabled again, so both wait for the
                  key to be live. Its detail page has
                  the Enable button. */}
              {canUpdate && vk.status === "active" && (
                <Menu.Item value="edit" onClick={onEdit}>
                  <Pencil size={14} /> Edit
                </Menu.Item>
              )}
              {canRotate && vk.status === "active" && (
                <Menu.Item value="rotate" onClick={onRotate}>
                  <RotateCw size={14} /> Rotate secret
                </Menu.Item>
              )}
              {canRevoke && (
                <Menu.Item value="revoke" onClick={onRevoke}>
                  <Trash2 size={14} /> Revoke
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Root>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

type SpendRow = VirtualKeySpendThisMonth[number];

function indexSpendRows(rows: SpendRow[]): {
  spendByKeyId: Map<string, string>;
  budgetByKeyId: Map<string, VirtualKeyBudgetBarValue>;
} {
  const spendByKeyId = new Map<string, string>();
  const budgetByKeyId = new Map<string, VirtualKeyBudgetBarValue>();
  for (const row of rows) {
    spendByKeyId.set(row.virtualKeyId, row.spentUsd);
    if (row.budget) budgetByKeyId.set(row.virtualKeyId, row.budget);
  }
  return { spendByKeyId, budgetByKeyId };
}

function indexScopeNames(teams: readonly GatewayTeam[]): {
  teamNameById: Map<string, string>;
  projectNameById: Map<string, string>;
} {
  const teamNameById = new Map<string, string>();
  const projectNameById = new Map<string, string>();
  for (const team of teams) {
    teamNameById.set(team.id, team.name);
    for (const project of team.projects) projectNameById.set(project.id, project.name);
  }
  return { teamNameById, projectNameById };
}

/** Keys whose traces can be opened; a key missing here gets no "View traces" action. */
function traceHrefsByKeyId(input: {
  rows: VirtualKeyDetail[];
  teams: readonly GatewayTeam[];
}): Map<string, string> {
  const map = new Map<string, string>();
  for (const vk of input.rows) {
    const href = resolveTracesHrefForKey({
      teams: input.teams,
      virtualKeyId: vk.id,
      traceProjectId: vk.traceProjectId,
      traceProjectArchived: vk.traceProjectArchived,
    });
    if (href) map.set(vk.id, href);
  }
  return map;
}

function VirtualKeysEmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <VStack gap={6} align="center" maxWidth="640px" marginX="auto" paddingY={8}>
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <KeyRound size={32} />
          </EmptyState.Indicator>
          <EmptyState.Title>No virtual keys yet</EmptyState.Title>
          <EmptyState.Description>
            Mint your first virtual key to route requests through the LangWatch AI Gateway with
            budgets, guardrails, and per-tenant tracing attached.
          </EmptyState.Description>
          {canCreate && (
            <Button colorPalette="orange" onClick={onCreate} mt={2}>
              <Plus size={14} /> New virtual key
            </Button>
          )}
        </EmptyState.Content>
      </EmptyState.Root>
      <GatewayCapabilityPreview />
    </VStack>
  );
}

type RotateVirtualKey = ReturnType<typeof api.virtualKeys.rotate.useMutation>["mutateAsync"];

/** Rotates a key's secret and hands the new one over to be shown once. */
async function rotateAndReveal(input: {
  rotate: RotateVirtualKey;
  organizationId: string;
  key: { id: string; name: string };
  onRotated: (secret: CreatedSecret) => void;
  onFailure: (error: unknown) => void;
}): Promise<void> {
  try {
    const result = await input.rotate({ organizationId: input.organizationId, id: input.key.id });
    input.onRotated({
      id: result.virtualKey.id,
      name: input.key.name,
      secret: result.secret,
      kind: "rotate",
    });
  } catch (err) {
    input.onFailure(err);
  }
}

function GatewayCapabilityPreview() {
  const rows: {
    icon: React.ReactNode;
    label: string;
    defaultValue: string;
    detail: string;
  }[] = [
    {
      icon: <Zap size={14} />,
      label: "Cache control",
      defaultValue: "respect",
      detail:
        "Provider-agnostic passthrough. Anthropic cache_control, OpenAI/Azure automatic, Gemini cachedContent. Switch to disable/force per key.",
    },
    {
      icon: <Shield size={14} />,
      label: "Guardrails",
      defaultValue: "none",
      detail:
        "Attach pre/post/stream_chunk monitors. Block-by-default, opt-in fail-open per direction.",
    },
    {
      icon: <Ban size={14} />,
      label: "Blocked patterns",
      defaultValue: "none",
      detail:
        "RE2 deny/allow for tools, MCP servers, URLs, and models. Enforced pre-provider-dispatch at zero cost.",
    },
    {
      icon: <Gauge size={14} />,
      label: "Rate limits",
      defaultValue: "unlimited",
      detail: "Per-VK RPM and RPD. 429 + Retry-After emitted by the gateway when exceeded.",
    },
  ];
  return (
    <VStack align="stretch" gap={2} width="full">
      <HStack>
        <Text fontSize="sm" fontWeight="semibold">
          What the gateway gives you
        </Text>
        <Badge colorPalette="gray" fontSize="2xs">
          preview
        </Badge>
      </HStack>
      <Box borderWidth="1px" borderColor="border.subtle" borderRadius="md" padding={3}>
        <VStack align="stretch" gap={3}>
          {rows.map((row) => (
            <HStack key={row.label} align="start" gap={3}>
              <Box color="fg.muted" mt={1}>
                {row.icon}
              </Box>
              <VStack align="start" gap={0} flex={1}>
                <HStack>
                  <Text fontSize="sm" fontWeight="medium">
                    {row.label}
                  </Text>
                  <Badge variant="subtle" colorPalette="gray" fontSize="2xs">
                    default: {row.defaultValue}
                  </Badge>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                  {row.detail}
                </Text>
              </VStack>
            </HStack>
          ))}
        </VStack>
      </Box>
      <Text fontSize="xs" color="fg.muted">
        Open the key's edit drawer after creation to configure any of these.
      </Text>
    </VStack>
  );
}

export default VirtualKeysPage;

function scopeDisplayName({
  scope,
  organizationName,
  teamNameById,
  projectNameById,
}: {
  scope: ScopeEntry;
  organizationName: string | undefined;
  teamNameById: Map<string, string>;
  projectNameById: Map<string, string>;
}) {
  if (scope.scopeType === "ORGANIZATION") return organizationName;
  if (scope.scopeType === "TEAM") return teamNameById.get(scope.scopeId);
  return projectNameById.get(scope.scopeId);
}

function resolveListView({
  isLoading,
  isError,
  rowCount,
}: {
  isLoading: boolean;
  isError: boolean;
  rowCount: number;
}): "loading" | "error" | "empty" | "list" {
  if (isLoading) return "loading";
  if (isError) return "error";
  if (rowCount === 0) return "empty";
  return "list";
}

function RoutingPolicyCell({
  routingPolicyId,
  routingMode,
  policyNameById,
}: {
  routingPolicyId: string | null;
  routingMode: string;
  policyNameById: Map<string, string>;
}) {
  if (routingPolicyId) {
    return (
      <Badge variant="subtle" colorPalette="purple">
        {policyNameById.get(routingPolicyId) ?? routingPolicyId}
      </Badge>
    );
  }
  if (routingMode === "FALLBACK_ALL") {
    return (
      <Text fontSize="xs" color="fg.muted">
        fallback
      </Text>
    );
  }
  return (
    <Text fontSize="xs" color="fg.muted">
      {"—"}
    </Text>
  );
}

function spendTone(spend: string | undefined): "fg" | "fg.muted" {
  return spend && Number.parseFloat(spend) > 0 ? "fg" : "fg.muted";
}

function spendLabel({
  isLoading,
  isError,
  spend,
}: {
  isLoading: boolean;
  isError: boolean;
  spend: string | undefined;
}): string {
  if (isLoading) return "…";
  if (isError) return "n/a";
  return formatBudgetUsd(spend ?? "0");
}

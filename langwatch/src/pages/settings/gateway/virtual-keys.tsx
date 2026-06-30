import {
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Table,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Ban,
  Eye,
  Gauge,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  RotateCw,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayErrorPanel } from "~/components/gateway/GatewayErrorPanel";
import { isLangyManagedVk } from "~/components/gateway/langyVk";
import { VirtualKeyCreateDrawer } from "~/components/gateway/VirtualKeyCreateDrawer";
import { VirtualKeyEditDrawer } from "~/components/gateway/VirtualKeyEditDrawer";
import { VirtualKeySecretReveal } from "~/components/gateway/VirtualKeySecretReveal";
import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type ScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

type CreatedSecret = {
  id: string;
  name: string;
  secret: string;
  // Differentiates mint flow (initial creation) from rotate — the
  // reveal dialog adds a 24h-grace banner on rotations.
  kind: "create" | "rotate";
};

function VirtualKeysPage() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const canCreate = hasPermission("virtualKeys:create");
  const canRotate = hasPermission("virtualKeys:rotate");
  const canRevoke = hasPermission("virtualKeys:delete");
  const canUpdate = hasPermission("virtualKeys:update");

  const utils = api.useContext();
  const orgId = organization?.id ?? "";
  const listQuery = api.virtualKeys.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );
  const policyNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of policiesQuery.data ?? []) {
      map.set(p.id, p.name);
    }
    return map;
  }, [policiesQuery.data]);
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
  const scopeEntriesWithNames = (scopes: ScopeEntry[]) =>
    scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      name:
        s.scopeType === "ORGANIZATION"
          ? organization?.name
          : s.scopeType === "TEAM"
            ? teamNameById.get(s.scopeId)
            : projectNameById.get(s.scopeId),
    }));
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () =>
      utils.virtualKeys.list.invalidate({ organizationId: orgId }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () =>
      utils.virtualKeys.list.invalidate({ organizationId: orgId }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [revealSecret, setRevealSecret] = useState<CreatedSecret | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [rotating, setRotating] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [revoking, setRevoking] = useState<{
    id: string;
    name: string;
    purpose: "user" | "langy";
  } | null>(null);
  const [statusTab, setStatusTab] = useState<"active" | "revoked">("active");

  const allRows = listQuery.data ?? [];
  const activeRows = useMemo(
    () => allRows.filter((vk) => vk.status === "active"),
    [allRows],
  );
  const revokedRows = useMemo(
    () => allRows.filter((vk) => vk.status === "revoked"),
    [allRows],
  );
  const rows = statusTab === "active" ? activeRows : revokedRows;

  const confirmRotate = async () => {
    if (!rotating || !orgId) return;
    try {
      const result = await rotateMutation.mutateAsync({
        organizationId: orgId,
        id: rotating.id,
      });
      setRevealSecret({
        id: result.virtualKey.id,
        name: rotating.name,
        secret: result.secret,
        kind: "rotate",
      });
      setRotating(null);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to rotate key",
        type: "error",
      });
    }
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
          <PageLayout.Heading>Virtual Keys</PageLayout.Heading>
          <Spacer />
          {canCreate && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} /> New virtual key
            </Button>
          )}
        </PageLayout.Header>

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
          {listQuery.isLoading ? (
            <Spinner />
          ) : listQuery.isError ? (
            <GatewayErrorPanel
              title="Failed to load virtual keys"
              error={listQuery.error}
              onRetry={() => listQuery.refetch()}
            />
          ) : allRows.length === 0 ? (
            <VStack
              gap={6}
              align="center"
              maxWidth="640px"
              marginX="auto"
              paddingY={8}
            >
              <EmptyState.Root>
                <EmptyState.Content>
                  <EmptyState.Indicator>
                    <KeyRound size={32} />
                  </EmptyState.Indicator>
                  <EmptyState.Title>No virtual keys yet</EmptyState.Title>
                  <EmptyState.Description>
                    Mint your first virtual key to route requests through the
                    LangWatch AI Gateway with budgets, guardrails, and
                    per-tenant tracing attached.
                  </EmptyState.Description>
                  {canCreate && (
                    <Button
                      colorPalette="orange"
                      onClick={() => setCreateOpen(true)}
                      mt={2}
                    >
                      <Plus size={14} /> New virtual key
                    </Button>
                  )}
                </EmptyState.Content>
              </EmptyState.Root>
              <GatewayCapabilityPreview />
            </VStack>
          ) : (
            <VStack align="stretch" gap={3} width="full">
              {revokedRows.length > 0 && (
                <Tabs.Root
                  value={statusTab}
                  onValueChange={(d) =>
                    setStatusTab(d.value as "active" | "revoked")
                  }
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
                    <Text
                      fontSize="sm"
                      color="fg.muted"
                      textAlign="center"
                      py={6}
                    >
                      No {statusTab} keys.
                    </Text>
                  </Card.Body>
                </Card.Root>
              ) : (
                <Card.Root width="full" overflow="hidden">
                  <Card.Body paddingY={0} paddingX={0}>
                    <Table.Root variant="line" size="md" width="full">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Name</Table.ColumnHeader>
                          <Table.ColumnHeader>Prefix</Table.ColumnHeader>
                          <Table.ColumnHeader>Status</Table.ColumnHeader>
                          <Table.ColumnHeader>Scopes</Table.ColumnHeader>
                          <Table.ColumnHeader>
                            Routing policy
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Last used</Table.ColumnHeader>
                          <Table.ColumnHeader></Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {rows.map((vk) => (
                          <Table.Row
                            key={vk.id}
                            cursor="pointer"
                            _hover={{ bg: "bg.subtle" }}
                            onClick={() =>
                              void router.push(
                                `/settings/gateway/virtual-keys/${vk.id}`,
                              )
                            }
                          >
                            <Table.Cell>
                              <VStack align="start" gap={1}>
                                <HStack gap={2} align="center">
                                  <Link
                                    href={`/settings/gateway/virtual-keys/${vk.id}`}
                                    fontWeight="medium"
                                  >
                                    {vk.name}
                                  </Link>
                                  {isLangyManagedVk(vk) && (
                                    <Tooltip content="Auto-provisioned by LangWatch for the Langy in-product assistant. You can edit its model, fallbacks, budget, and rate limits like any other virtual key. Revoking it will break Langy until you create a new one.">
                                      <Badge
                                        variant="subtle"
                                        colorPalette="purple"
                                        fontSize="2xs"
                                        data-testid="langy-vk-badge"
                                      >
                                        auto-managed
                                      </Badge>
                                    </Tooltip>
                                  )}
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
                                        <Badge
                                          key={t}
                                          variant="subtle"
                                          colorPalette="gray"
                                          fontSize="2xs"
                                        >
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
                              <Badge
                                colorPalette={
                                  vk.status === "active" ? "green" : "red"
                                }
                              >
                                {vk.status}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell>
                              <ProviderScopeChips
                                scopes={scopeEntriesWithNames(vk.scopes)}
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
                              {vk.routingPolicyId ? (
                                <Badge variant="subtle" colorPalette="purple">
                                  {policyNameById.get(vk.routingPolicyId) ??
                                    vk.routingPolicyId}
                                </Badge>
                              ) : (
                                <Text fontSize="xs" color="fg.muted">
                                  default cascade
                                </Text>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              {vk.lastUsedAt ? (
                                <Tooltip
                                  content={new Date(
                                    vk.lastUsedAt,
                                  ).toLocaleString()}
                                >
                                  <Text fontSize="sm">
                                    {formatTimeAgo(
                                      new Date(vk.lastUsedAt).getTime(),
                                    )}
                                  </Text>
                                </Tooltip>
                              ) : (
                                <Text fontSize="sm" color="fg.muted">
                                  never
                                </Text>
                              )}
                            </Table.Cell>
                            <Table.Cell
                              onClick={(e) => e.stopPropagation()}
                              cursor="default"
                            >
                              {vk.status === "active" && (
                                <Menu.Root>
                                  <Menu.Trigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      aria-label="Actions"
                                    >
                                      <MoreVertical size={14} />
                                    </Button>
                                  </Menu.Trigger>
                                  <Menu.Content>
                                    <Menu.Item
                                      value="details"
                                      onClick={() =>
                                        void router.push(
                                          `/settings/gateway/virtual-keys/${vk.id}`,
                                        )
                                      }
                                    >
                                      <Eye size={14} /> Details
                                    </Menu.Item>
                                    {canUpdate && (
                                      <Menu.Item
                                        value="edit"
                                        onClick={() => setEditing(vk)}
                                      >
                                        <Pencil size={14} /> Edit
                                      </Menu.Item>
                                    )}
                                    {canRotate && (
                                      <Menu.Item
                                        value="rotate"
                                        onClick={() =>
                                          setRotating({
                                            id: vk.id,
                                            name: vk.name,
                                          })
                                        }
                                      >
                                        <RotateCw size={14} /> Rotate secret
                                      </Menu.Item>
                                    )}
                                    {canRevoke && (
                                      <Menu.Item
                                        value="revoke"
                                        onClick={() =>
                                          setRevoking({
                                            id: vk.id,
                                            name: vk.name,
                                            purpose: vk.purpose,
                                          })
                                        }
                                      >
                                        <Trash2 size={14} /> Revoke
                                      </Menu.Item>
                                    )}
                                  </Menu.Content>
                                </Menu.Root>
                              )}
                            </Table.Cell>
                          </Table.Row>
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
          onCreated={(created) =>
            setRevealSecret({ ...created, kind: "create" })
          }
        />
      )}
      <VirtualKeySecretReveal
        open={!!revealSecret}
        onClose={() => setRevealSecret(null)}
        keyName={revealSecret?.name ?? ""}
        secret={revealSecret?.secret ?? ""}
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
        message={
          // The Langy VK is technically revocable like any other VK, but
          // revoking it stops the in-product assistant cold. Lead with the
          // Langy-specific consequence before the generic 401 warning so
          // someone clicking through doesn't accidentally break Langy.
          revoking && isLangyManagedVk(revoking)
            ? "This is the auto-provisioned Langy virtual key. Revoking it will stop the in-product assistant from working until a new one is provisioned (it'll be re-created automatically on the next chat). Clients using this secret directly start receiving 401s within ~60 seconds. This cannot be undone — revoked keys are never reactivated."
            : "Clients using this key start receiving 401s within ~60 seconds. This cannot be undone — revoked keys are never reactivated."
        }
        confirmLabel="Revoke key"
        tone="danger"
        loading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
      />
    </AiGatewayLayout>
  );
}

function GatewayCapabilityPreview() {
  const rows: Array<{
    icon: React.ReactNode;
    label: string;
    defaultValue: string;
    detail: string;
  }> = [
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
      detail:
        "Per-VK RPM and RPD. 429 + Retry-After emitted by the gateway when exceeded.",
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
      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="md"
        padding={3}
      >
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

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: AiGatewayLayout,
})(VirtualKeysPage);

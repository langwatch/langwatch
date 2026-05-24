import {
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Eye, KeyRound, MoreVertical, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "~/utils/compat/next-router";

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayErrorPanel } from "~/components/gateway/GatewayErrorPanel";
import { Link } from "~/components/ui/link";
import { VirtualKeyCreateDrawer } from "~/components/gateway/VirtualKeyCreateDrawer";
import { VirtualKeyEditDrawer } from "~/components/gateway/VirtualKeyEditDrawer";
import { VirtualKeySecretReveal } from "~/components/gateway/VirtualKeySecretReveal";
import { Menu } from "~/components/ui/menu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { api } from "~/utils/api";

type ScopeEntry = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };

type CreatedSecret = {
  id: string;
  name: string;
  secret: string;
  // Differentiates mint flow (initial creation) from rotate — the
  // reveal dialog adds a 24h-grace banner on rotations.
  kind: "create" | "rotate";
};

function VirtualKeysPage() {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
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
  const ScopeChipList = ({ scopes }: { scopes: ScopeEntry[] }) => {
    if (!scopes || scopes.length === 0) {
      return (
        <Text fontSize="xs" color="fg.muted">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1} flexWrap="wrap">
        {scopes.map((s) => {
          const label =
            s.scopeType === "ORGANIZATION"
              ? `ORG${organization?.name ? `:${organization.name}` : ""}`
              : s.scopeType === "TEAM"
              ? `TEAM:${teamNameById.get(s.scopeId) ?? s.scopeId}`
              : `PROJECT:${projectNameById.get(s.scopeId) ?? s.scopeId}`;
          const palette =
            s.scopeType === "ORGANIZATION"
              ? "blue"
              : s.scopeType === "TEAM"
              ? "purple"
              : "teal";
          return (
            <Badge
              key={`${s.scopeType}:${s.scopeId}`}
              variant="subtle"
              colorPalette={palette}
              fontSize="2xs"
            >
              {label}
            </Badge>
          );
        })}
      </HStack>
    );
  };
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () => utils.virtualKeys.list.invalidate({ organizationId: orgId }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () => utils.virtualKeys.list.invalidate({ organizationId: orgId }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [revealSecret, setRevealSecret] = useState<CreatedSecret | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [rotating, setRotating] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  const rows = listQuery.data ?? [];

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
              colorPalette="orange"
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
          ) : rows.length === 0 ? (
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
                  <Table.ColumnHeader>Routing policy</Table.ColumnHeader>
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
                        <Link
                          href={`/settings/gateway/virtual-keys/${vk.id}`}
                          fontWeight="medium"
                        >
                          {vk.name}
                        </Link>
                        {vk.description && (
                          <Text fontSize="xs" color="fg.muted">
                            {vk.description}
                          </Text>
                        )}
                        {(() => {
                          const tags =
                            (vk.config as { metadata?: { tags?: string[] } })
                              ?.metadata?.tags ?? [];
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
                        colorPalette={vk.status === "active" ? "green" : "red"}
                      >
                        {vk.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <ScopeChipList scopes={vk.scopes} />
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
                          content={new Date(vk.lastUsedAt).toLocaleString()}
                        >
                          <Text fontSize="sm">
                            {formatTimeAgo(new Date(vk.lastUsedAt).getTime())}
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
                            <Button variant="ghost" size="xs" aria-label="Actions">
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
                                  setRotating({ id: vk.id, name: vk.name })
                                }
                              >
                                <RotateCw size={14} /> Rotate secret
                              </Menu.Item>
                            )}
                            {canRevoke && (
                              <Menu.Item
                                value="revoke"
                                onClick={() =>
                                  setRevoking({ id: vk.id, name: vk.name })
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
          projectId={project?.id}
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
        message="Clients using this key start receiving 401s within ~60 seconds. This cannot be undone — revoked keys are never reactivated."
        confirmLabel="Revoke key"
        tone="danger"
        loading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
      />
    </AiGatewayLayout>
  );
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: AiGatewayLayout,
})(VirtualKeysPage);

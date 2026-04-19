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
import { KeyRound, MoreVertical, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayErrorPanel } from "~/components/gateway/GatewayErrorPanel";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { Link } from "~/components/ui/link";
import { VirtualKeyCreateDrawer } from "~/components/gateway/VirtualKeyCreateDrawer";
import { VirtualKeyEditDrawer } from "~/components/gateway/VirtualKeyEditDrawer";
import { VirtualKeySecretReveal } from "~/components/gateway/VirtualKeySecretReveal";
import { Menu } from "~/components/ui/menu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { api } from "~/utils/api";

type CreatedSecret = {
  id: string;
  name: string;
  secret: string;
  // Differentiates mint flow (initial creation) from rotate — the
  // reveal dialog adds a 24h-grace banner on rotations.
  kind: "create" | "rotate";
};

function VirtualKeysPage() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const canCreate = hasPermission("virtualKeys:create");
  const canRotate = hasPermission("virtualKeys:rotate");
  const canRevoke = hasPermission("virtualKeys:update");
  const canUpdate = hasPermission("virtualKeys:update");

  const utils = api.useContext();
  const listQuery = api.virtualKeys.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const rotateMutation = api.virtualKeys.rotate.useMutation({
    onSuccess: () => utils.virtualKeys.list.invalidate({ projectId: project?.id }),
  });
  const revokeMutation = api.virtualKeys.revoke.useMutation({
    onSuccess: () => utils.virtualKeys.list.invalidate({ projectId: project?.id }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [revealSecret, setRevealSecret] = useState<CreatedSecret | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [rotating, setRotating] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  const rows = listQuery.data ?? [];

  const confirmRotate = async () => {
    if (!rotating || !project?.id) return;
    try {
      const result = await rotateMutation.mutateAsync({
        projectId: project.id,
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
    if (!revoking || !project?.id) return;
    try {
      await revokeMutation.mutateAsync({
        projectId: project.id,
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
    <GatewayLayout>
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
                  <Table.ColumnHeader>Environment</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Providers</Table.ColumnHeader>
                  <Table.ColumnHeader>Last used</Table.ColumnHeader>
                  <Table.ColumnHeader></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((vk) => (
                  <Table.Row key={vk.id}>
                    <Table.Cell>
                      <VStack align="start" gap={1}>
                        <Link
                          href={`/${project?.slug}/gateway/virtual-keys/${vk.id}`}
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
                        colorPalette={vk.environment === "live" ? "green" : "gray"}
                      >
                        {vk.environment}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        colorPalette={vk.status === "active" ? "green" : "red"}
                      >
                        {vk.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <ProviderChainBadges
                        chain={vk.providerChain ?? []}
                        fallbackLength={vk.fallbackChainLength}
                      />
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
                    <Table.Cell>
                      {vk.status === "active" && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button variant="ghost" size="xs" aria-label="Actions">
                              <MoreVertical size={14} />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
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

      {project?.id && (
        <VirtualKeyCreateDrawer
          projectId={project.id}
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
      {project?.id && (
        <VirtualKeyEditDrawer
          projectId={project.id}
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
    </GatewayLayout>
  );
}

type ChainEntry = {
  providerCredentialId: string;
  slot: string;
  providerType: string;
};

function ProviderChainBadges({
  chain,
  fallbackLength,
}: {
  chain: ChainEntry[];
  fallbackLength: number;
}) {
  // Graceful fallback: if the router hasn't enriched yet (or an old
  // cache returns without providerChain), show the plain count.
  if (chain.length === 0) {
    return <Text fontSize="sm">{fallbackLength}</Text>;
  }
  const label = chain.map((c) => c.providerType).join(" → ");
  return (
    <Tooltip content={label}>
      <HStack gap={1}>
        {chain.map((entry, idx) => {
          const icon =
            entry.providerType in modelProviderIcons
              ? modelProviderIcons[
                  entry.providerType as keyof typeof modelProviderIcons
                ]
              : null;
          return (
            <HStack
              key={entry.providerCredentialId}
              gap={1}
              align="center"
            >
              <Box
                width="16px"
                height="16px"
                flexShrink={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
                opacity={idx === 0 ? 1 : 0.6}
                css={{
                  "& > svg": {
                    width: "100%",
                    height: "100%",
                  },
                }}
              >
                {icon}
              </Box>
              {idx < chain.length - 1 && (
                <Text fontSize="2xs" color="fg.muted">
                  →
                </Text>
              )}
            </HStack>
          );
        })}
      </HStack>
    </Tooltip>
  );
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: DashboardLayout,
})(VirtualKeysPage);

import {
  Badge,
  Box,
  Button,
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
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { VirtualKeyCreateDrawer } from "~/components/gateway/VirtualKeyCreateDrawer";
import { VirtualKeyEditDrawer } from "~/components/gateway/VirtualKeyEditDrawer";
import { VirtualKeySecretReveal } from "~/components/gateway/VirtualKeySecretReveal";
import { Menu } from "~/components/ui/menu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type CreatedSecret = { id: string; name: string; secret: string };

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

  const rows = listQuery.data ?? [];

  const handleRotate = async (id: string, name: string) => {
    if (!project?.id) return;
    try {
      const result = await rotateMutation.mutateAsync({
        projectId: project.id,
        id,
      });
      setRevealSecret({ id: result.virtualKey.id, name, secret: result.secret });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to rotate key",
        type: "error",
      });
    }
  };

  const handleRevoke = async (id: string) => {
    if (!project?.id) return;
    if (!confirm("Revoke this virtual key? Clients using it will start receiving 401s within 60 seconds.")) {
      return;
    }
    try {
      await revokeMutation.mutateAsync({ projectId: project.id, id });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to revoke key",
        type: "error",
      });
    }
  };

  return (
    <GatewayLayout>
      <PageLayout.Container>
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

        <Box padding={6}>
          {listQuery.isLoading ? (
            <Spinner />
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
            <Table.Root size="sm">
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
                      <VStack align="start" gap={0}>
                        <Text fontWeight="medium">{vk.name}</Text>
                        {vk.description && (
                          <Text fontSize="xs" color="fg.muted">
                            {vk.description}
                          </Text>
                        )}
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
                    <Table.Cell>{vk.fallbackChainLength}</Table.Cell>
                    <Table.Cell>
                      {vk.lastUsedAt
                        ? new Date(vk.lastUsedAt).toLocaleString()
                        : "—"}
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
                                onClick={() => handleRotate(vk.id, vk.name)}
                              >
                                <RotateCw size={14} /> Rotate secret
                              </Menu.Item>
                            )}
                            {canRevoke && (
                              <Menu.Item
                                value="revoke"
                                onClick={() => handleRevoke(vk.id)}
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
          )}
        </Box>
      </PageLayout.Container>

      {project?.id && (
        <VirtualKeyCreateDrawer
          projectId={project.id}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(created) => setRevealSecret(created)}
        />
      )}
      <VirtualKeySecretReveal
        open={!!revealSecret}
        onClose={() => setRevealSecret(null)}
        keyName={revealSecret?.name ?? ""}
        secret={revealSecret?.secret ?? ""}
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
    </GatewayLayout>
  );
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: DashboardLayout,
})(VirtualKeysPage);

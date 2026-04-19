import {
  Badge,
  Box,
  Button,
  EmptyState,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical, Pencil, Plug, Plus, PowerOff, RefreshCw } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { ProviderBindingCreateDrawer } from "~/components/gateway/ProviderBindingCreateDrawer";
import { ProviderBindingEditDrawer } from "~/components/gateway/ProviderBindingEditDrawer";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type ProviderRow = {
  id: string;
  modelProviderName: string;
  slot: string;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  rotationPolicy: string;
  fallbackPriorityGlobal: number | null;
  healthStatus: string;
  disabledAt: string | null;
};

function ProvidersPage() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const canManage = hasPermission("gatewayProviders:manage");
  const listQuery = api.gatewayProviders.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const utils = api.useContext();
  const disableMutation = api.gatewayProviders.disable.useMutation({
    onSuccess: () =>
      utils.gatewayProviders.list.invalidate({ projectId: project?.id }),
  });

  const [bindOpen, setBindOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [disabling, setDisabling] = useState<ProviderRow | null>(null);

  const confirmDisable = async () => {
    if (!disabling || !project?.id) return;
    try {
      await disableMutation.mutateAsync({
        projectId: project.id,
        id: disabling.id,
      });
      setDisabling(null);
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to disable",
        type: "error",
      });
    }
  };

  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Providers</PageLayout.Heading>
          <Spacer />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => listQuery.refetch()}
            loading={listQuery.isFetching}
          >
            <RefreshCw size={14} /> Refresh
          </Button>
          {canManage && (
            <Button
              colorPalette="orange"
              size="sm"
              onClick={() => setBindOpen(true)}
            >
              <Plus size={14} /> Bind provider
            </Button>
          )}
        </PageLayout.Header>
        <Box padding={6}>
          {listQuery.isLoading ? (
            <Spinner />
          ) : (listQuery.data ?? []).length === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <Plug size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No providers bound to the gateway yet</EmptyState.Title>
                <EmptyState.Description>
                  Configure an OpenAI / Anthropic / Azure / Bedrock / Vertex
                  provider in{" "}
                  <Link href="/settings/model-providers" color="orange.600">
                    Settings → Model Providers
                  </Link>
                  , then bind it to the AI Gateway here. The gateway reuses
                  the existing ModelProvider credentials; binding only adds
                  gateway-specific settings like rate limits and rotation.
                </EmptyState.Description>
                {canManage && (
                  <Button
                    colorPalette="orange"
                    onClick={() => setBindOpen(true)}
                    mt={2}
                  >
                    <Plug size={14} /> Bind your first provider
                  </Button>
                )}
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Provider</Table.ColumnHeader>
                  <Table.ColumnHeader>Slot</Table.ColumnHeader>
                  <Table.ColumnHeader>Health</Table.ColumnHeader>
                  <Table.ColumnHeader>Rate limits</Table.ColumnHeader>
                  <Table.ColumnHeader>Rotation</Table.ColumnHeader>
                  <Table.ColumnHeader>Priority</Table.ColumnHeader>
                  <Table.ColumnHeader></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(listQuery.data ?? []).map((row) => (
                  <Table.Row key={row.id}>
                    <Table.Cell>
                      <Text fontWeight="medium">{row.modelProviderName}</Text>
                    </Table.Cell>
                    <Table.Cell>{row.slot}</Table.Cell>
                    <Table.Cell>
                      <HealthBadge status={row.healthStatus} />
                    </Table.Cell>
                    <Table.Cell>
                      <VStack align="start" gap={0}>
                        <Text fontSize="xs">rpm: {row.rateLimitRpm ?? "∞"}</Text>
                        <Text fontSize="xs">rpd: {row.rateLimitRpd ?? "∞"}</Text>
                      </VStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant="outline">
                        {row.rotationPolicy.toLowerCase()}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {row.fallbackPriorityGlobal ?? "—"}
                    </Table.Cell>
                    <Table.Cell>
                      {canManage && !row.disabledAt && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button variant="ghost" size="xs" aria-label="Actions">
                              <MoreVertical size={14} />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              onClick={() => setEditing(row)}
                            >
                              <Pencil size={14} /> Edit
                            </Menu.Item>
                            <Menu.Item
                              value="disable"
                              onClick={() => setDisabling(row)}
                            >
                              <PowerOff size={14} /> Disable
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Root>
                      )}
                      {row.disabledAt && (
                        <Badge colorPalette="gray">disabled</Badge>
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
        <ProviderBindingCreateDrawer
          projectId={project.id}
          open={bindOpen}
          onOpenChange={setBindOpen}
          onCreated={() => {
            void listQuery.refetch();
          }}
        />
      )}
      {project?.id && (
        <ProviderBindingEditDrawer
          projectId={project.id}
          binding={editing}
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
        open={!!disabling}
        onOpenChange={(open) => {
          if (!open) setDisabling(null);
        }}
        title={`Disable ${disabling?.modelProviderName ?? "provider"} binding?`}
        message="VKs routing to this slot will fail over to the next provider in their fallback chain. The underlying ModelProvider credentials are not touched."
        confirmLabel="Disable binding"
        tone="warning"
        loading={disableMutation.isPending}
        onConfirm={confirmDisable}
      />
    </GatewayLayout>
  );
}

function HealthBadge({ status }: { status: string }) {
  const palette =
    status === "HEALTHY"
      ? "green"
      : status === "DEGRADED"
        ? "yellow"
        : status === "CIRCUIT_OPEN"
          ? "red"
          : "gray";
  return <Badge colorPalette={palette}>{status.toLowerCase()}</Badge>;
}

export default withPermissionGuard("gatewayProviders:view", {
  layoutComponent: DashboardLayout,
})(ProvidersPage);

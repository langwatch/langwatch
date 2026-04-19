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
  Text,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical, Pencil, Plug, Plus, PowerOff } from "lucide-react";
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
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

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
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Providers</PageLayout.Heading>
          <Spacer />
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
        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
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
                  Configure an LLM
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
            <Card.Root width="full" overflow="hidden">
              <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Provider</Table.ColumnHeader>
                  <Table.ColumnHeader>Slot</Table.ColumnHeader>
                  <Table.ColumnHeader>Health</Table.ColumnHeader>
                  <Table.ColumnHeader>Rate limits</Table.ColumnHeader>
                  <Table.ColumnHeader>Priority</Table.ColumnHeader>
                  <Table.ColumnHeader></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(listQuery.data ?? []).map((row) => {
                  const providerKey =
                    row.modelProviderName as keyof typeof modelProviderIcons;
                  const icon = modelProviderIcons[providerKey];
                  return (
                    <Table.Row key={row.id}>
                      <Table.Cell>
                        <HStack gap={2}>
                          <Box
                            width="20px"
                            height="20px"
                            flexShrink={0}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            css={{
                              "& > svg": {
                                width: "100%",
                                height: "100%",
                              },
                            }}
                          >
                            {icon}
                          </Box>
                          <VStack align="start" gap={0}>
                            <Text fontWeight="medium">
                              {row.modelProviderName}
                            </Text>
                            {row.disabledAt && (
                              <Text fontSize="2xs" color="fg.muted">
                                disabled{" "}
                                {new Date(row.disabledAt).toLocaleDateString()}
                              </Text>
                            )}
                          </VStack>
                        </HStack>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant="subtle" colorPalette="gray">
                          {row.slot}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <HealthBadge status={row.healthStatus} />
                      </Table.Cell>
                      <Table.Cell>
                        <HStack gap={1} flexWrap="wrap">
                          <Badge variant="outline" fontSize="2xs">
                            rpm {row.rateLimitRpm ?? "∞"}
                          </Badge>
                          <Badge variant="outline" fontSize="2xs">
                            rpd {row.rateLimitRpd ?? "∞"}
                          </Badge>
                        </HStack>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="fg.muted">
                          {row.fallbackPriorityGlobal ?? "—"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        {canManage && !row.disabledAt && (
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
                          <Badge colorPalette="gray" variant="subtle">
                            disabled
                          </Badge>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
              </Card.Body>
            </Card.Root>
          )}
        </Box>
      </>
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

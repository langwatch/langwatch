import {
  Badge,
  Box,
  Button,
  EmptyState,
  HStack,
  Progress,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, Gauge, MoreVertical, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { BudgetCreateDrawer } from "~/components/gateway/BudgetCreateDrawer";
import { BudgetEditDrawer } from "~/components/gateway/BudgetEditDrawer";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type BudgetListRow = ReturnType<typeof useBudgetRows>["rows"][number];

function useBudgetRows(organizationId: string | undefined) {
  const listQuery = api.gatewayBudgets.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );
  return { rows: listQuery.data ?? [], isLoading: listQuery.isLoading, refetch: listQuery.refetch };
}

function BudgetsPage() {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
  const canCreate = hasPermission("gatewayBudgets:create");
  const canUpdate = hasPermission("gatewayBudgets:update");
  const canDelete = hasPermission("gatewayBudgets:delete");

  const { rows, isLoading, refetch } = useBudgetRows(organization?.id);

  const utils = api.useContext();
  const archiveMutation = api.gatewayBudgets.archive.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayBudgets.list.invalidate({
          organizationId: organization.id,
        });
      }
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetListRow | null>(null);
  const [archiving, setArchiving] = useState<BudgetListRow | null>(null);

  const confirmArchive = async () => {
    if (!archiving || !organization) return;
    try {
      await archiveMutation.mutateAsync({
        organizationId: organization.id,
        id: archiving.id,
      });
      setArchiving(null);
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to archive",
        type: "error",
      });
    }
  };

  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Budgets</PageLayout.Heading>
          <Spacer />
          {canCreate && (
            <Button
              colorPalette="orange"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} /> New budget
            </Button>
          )}
        </PageLayout.Header>

        <Box padding={6}>
          {isLoading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <Gauge size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No budgets yet</EmptyState.Title>
                <EmptyState.Description>
                  Hierarchical budgets enforce a spend ceiling across
                  organization, team, project, virtual-key, or principal.
                  Create one to start governing cost.
                </EmptyState.Description>
                {canCreate && (
                  <Button
                    colorPalette="orange"
                    onClick={() => setCreateOpen(true)}
                    mt={2}
                  >
                    <Plus size={14} /> New budget
                  </Button>
                )}
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Scope</Table.ColumnHeader>
                  <Table.ColumnHeader>Window</Table.ColumnHeader>
                  <Table.ColumnHeader>Spent / Limit</Table.ColumnHeader>
                  <Table.ColumnHeader>On breach</Table.ColumnHeader>
                  <Table.ColumnHeader>Resets</Table.ColumnHeader>
                  <Table.ColumnHeader></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((b) => {
                  const spent = Number.parseFloat(b.spentUsd);
                  const limit = Number.parseFloat(b.limitUsd);
                  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                  return (
                    <Table.Row key={b.id}>
                      <Table.Cell>
                        <VStack align="start" gap={0}>
                          <Text fontWeight="medium">{b.name}</Text>
                          {b.description && (
                            <Text fontSize="xs" color="fg.muted">
                              {b.description}
                            </Text>
                          )}
                        </VStack>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette="gray">
                          {b.scopeType.toLowerCase()}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs">{b.window.toLowerCase()}</Text>
                      </Table.Cell>
                      <Table.Cell minWidth="200px">
                        <VStack align="stretch" gap={1}>
                          <HStack fontSize="xs">
                            <Text fontWeight="medium">
                              ${spent.toFixed(2)}
                            </Text>
                            <Text color="fg.muted">/ ${limit.toFixed(2)}</Text>
                          </HStack>
                          <Progress.Root
                            value={pct}
                            size="xs"
                            colorPalette={
                              pct >= 100 ? "red" : pct >= 80 ? "orange" : "green"
                            }
                          >
                            <Progress.Track>
                              <Progress.Range />
                            </Progress.Track>
                          </Progress.Root>
                        </VStack>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge
                          colorPalette={b.onBreach === "BLOCK" ? "red" : "yellow"}
                        >
                          {b.onBreach.toLowerCase()}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs">
                          {b.window === "TOTAL"
                            ? "never"
                            : new Date(b.resetsAt).toLocaleString()}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        {(canUpdate || canDelete) && (
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
                                  onClick={() => setEditing(b)}
                                >
                                  <Pencil size={14} /> Edit
                                </Menu.Item>
                              )}
                              {canDelete && (
                                <Menu.Item
                                  value="archive"
                                  onClick={() => setArchiving(b)}
                                >
                                  <Archive size={14} /> Archive
                                </Menu.Item>
                              )}
                            </Menu.Content>
                          </Menu.Root>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}
        </Box>
      </PageLayout.Container>

      {project?.id && (
        <BudgetCreateDrawer
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            void refetch();
          }}
        />
      )}
      <BudgetEditDrawer
        budget={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void refetch();
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Archive ${archiving?.name ?? "budget"}?`}
        message="Debits against this budget stop counting. The historical ledger is preserved but new requests route as if the budget didn't exist."
        confirmLabel="Archive"
        tone="warning"
        loading={archiveMutation.isPending}
        onConfirm={confirmArchive}
      />
    </GatewayLayout>
  );
}

export default withPermissionGuard("gatewayBudgets:view", {
  layoutComponent: DashboardLayout,
})(BudgetsPage);

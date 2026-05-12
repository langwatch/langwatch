import {
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  HStack,
  Progress,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, Eye, Gauge, MoreVertical, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "~/utils/compat/next-router";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { BudgetCreateDrawer } from "~/components/gateway/BudgetCreateDrawer";
import { BudgetEditDrawer } from "~/components/gateway/BudgetEditDrawer";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayErrorPanel } from "~/components/gateway/GatewayErrorPanel";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { Link } from "~/components/ui/link";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type BudgetListRow = ReturnType<typeof useBudgetRows>["rows"][number];

function useBudgetRows(organizationId: string | undefined) {
  const listQuery = api.gatewayBudgets.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );
  return {
    rows: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
  };
}

function BudgetsPage() {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
  const canCreate = hasPermission("gatewayBudgets:create");
  const canUpdate = hasPermission("gatewayBudgets:update");
  const canDelete = hasPermission("gatewayBudgets:delete");

  const router = useRouter();
  const { rows, isLoading, isError, error, refetch } = useBudgetRows(
    organization?.id,
  );

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
      <>
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

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
          {isLoading ? (
            <Spinner />
          ) : isError ? (
            <GatewayErrorPanel
              title="Failed to load budgets"
              error={error}
              onRetry={() => refetch()}
            />
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
            <Card.Root width="full" overflow="hidden">
              <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Scope</Table.ColumnHeader>
                  <Table.ColumnHeader>Window</Table.ColumnHeader>
                  <Table.ColumnHeader>Spent / Limit</Table.ColumnHeader>
                  <Table.ColumnHeader>
                    <Tooltip
                      content={
                        <Text fontSize="xs">
                          WARN: emits 402-equivalent warning header +
                          audit event, request proceeds.{"\n"}BLOCK: the
                          gateway returns HTTP 402 and refuses to
                          dispatch once the limit is crossed.
                        </Text>
                      }
                    >
                      <Text as="span">On breach</Text>
                    </Tooltip>
                  </Table.ColumnHeader>
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
                    <Table.Row
                      key={b.id}
                      cursor="pointer"
                      _hover={{ bg: "bg.subtle" }}
                      onClick={() =>
                        void router.push(
                          `/${project?.slug}/gateway/budgets/${b.id}`,
                        )
                      }
                    >
                      <Table.Cell>
                        <VStack align="start" gap={0}>
                          <Link
                            href={`/${project?.slug}/gateway/budgets/${b.id}`}
                          >
                            <Text fontWeight="medium">{b.name}</Text>
                          </Link>
                          {b.description && (
                            <Text fontSize="xs" color="fg.muted">
                              {b.description}
                            </Text>
                          )}
                        </VStack>
                      </Table.Cell>
                      <Table.Cell>
                        <ScopeCell
                          scopeType={b.scopeType}
                          scopeTarget={b.scopeTarget ?? null}
                          projectSlug={project?.slug ?? null}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant="subtle" colorPalette="gray">
                          {b.window.toLowerCase()}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell minWidth="220px">
                        <VStack align="stretch" gap={1}>
                          <HStack fontSize="xs">
                            <Text fontWeight="medium">
                              ${spent.toFixed(2)}
                            </Text>
                            <Text color="fg.muted">/ ${limit.toFixed(2)}</Text>
                            <Spacer />
                            <Badge
                              variant="outline"
                              colorPalette={
                                pct >= 100
                                  ? "red"
                                  : pct >= 80
                                    ? "orange"
                                    : "green"
                              }
                              fontSize="2xs"
                            >
                              {pct.toFixed(0)}%
                            </Badge>
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
                        {b.window === "TOTAL" ? (
                          <Text fontSize="xs" color="fg.muted">
                            never
                          </Text>
                        ) : (
                          <Tooltip
                            content={new Date(b.resetsAt).toLocaleString()}
                          >
                            <Text fontSize="xs">
                              {formatTimeAgo(new Date(b.resetsAt).getTime())}
                            </Text>
                          </Tooltip>
                        )}
                      </Table.Cell>
                      <Table.Cell
                        onClick={(e) => e.stopPropagation()}
                        cursor="default"
                      >
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
                                  `/${project?.slug}/gateway/budgets/${b.id}`,
                                )
                              }
                            >
                              <Eye size={14} /> Details
                            </Menu.Item>
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

type ScopeTarget = {
  kind: string;
  id: string;
  name: string;
  secondary?: string | null;
  projectSlug?: string | null;
};

function ScopeCell({
  scopeType,
  scopeTarget,
  projectSlug,
}: {
  scopeType: string;
  scopeTarget: ScopeTarget | null;
  projectSlug: string | null;
}) {
  const kindLabel = scopeType.toLowerCase().replace("_", " ");
  const vkHref =
    scopeTarget?.kind === "VIRTUAL_KEY"
      ? `/${scopeTarget.projectSlug ?? projectSlug ?? ""}/gateway/virtual-keys/${scopeTarget.id}`
      : null;
  return (
    <VStack align="start" gap={0.5}>
      <Badge colorPalette="gray">{kindLabel}</Badge>
      {scopeTarget && (
        <HStack gap={1}>
          {vkHref ? (
            <Link href={vkHref} color="orange.600" fontSize="xs">
              {scopeTarget.name}
            </Link>
          ) : (
            <Text fontSize="xs" fontWeight="medium">
              {scopeTarget.name}
            </Text>
          )}
          {scopeTarget.secondary && (
            <Text fontSize="2xs" color="fg.muted">
              ({scopeTarget.secondary})
            </Text>
          )}
        </HStack>
      )}
    </VStack>
  );
}

export default withPermissionGuard("gatewayBudgets:view", {
  layoutComponent: DashboardLayout,
})(BudgetsPage);

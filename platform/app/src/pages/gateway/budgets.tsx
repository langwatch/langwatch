import {
  Alert,
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
import {
  Archive,
  Eye,
  Gauge,
  MoreVertical,
  Pencil,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { BudgetCreateDrawer } from "~/components/gateway/BudgetCreateDrawer";
import { BudgetEditDrawer } from "~/components/gateway/BudgetEditDrawer";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import { GatewayErrorPanel } from "~/components/gateway/GatewayErrorPanel";
import {
  ProviderScopeChips,
  type ProviderScopeType,
} from "~/components/settings/ProviderScopeChips";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type BudgetListRow = ReturnType<typeof useBudgetRows>["rows"][number];

function useBudgetRows(organizationId: string | undefined) {
  const listQuery = api.gatewayBudgets.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );
  return {
    rows: listQuery.data?.budgets ?? [],
    spendAvailable: listQuery.data?.spendAvailable ?? true,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
  };
}

function BudgetsPage() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const canCreate = hasPermission("gatewayBudgets:create");
  const canUpdate = hasPermission("gatewayBudgets:update");
  const canDelete = hasPermission("gatewayBudgets:delete");

  const router = useRouter();
  const { rows, spendAvailable, isLoading, isError, error, refetch } =
    useBudgetRows(organization?.id);

  const utils = api.useUtils();
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
      showErrorToast({ error, fallbackTitle: "Couldn't archive the budget" });
    }
  };

  return (
    <AiGatewayLayout>
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
                  Budgets enforce a spend ceiling on any dimension:
                  organization, group, team, project, member, or virtual key;
                  each optionally limited to a single provider. Create one to
                  start governing cost.
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
            <VStack align="stretch" gap={4}>
              {!spendAvailable && (
                <Alert.Root
                  status="warning"
                  data-testid="budget-spend-unavailable"
                >
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Spend figures are unavailable</Alert.Title>
                    <Alert.Description>
                      Spend cannot be totalled right now, so these budgets are
                      not stopping or warning about anything.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
              <Card.Root width="full" overflow="hidden">
                {/* The card clips; the body scrolls. Without this the
                    right-hand columns are simply unreachable on a narrow
                    window instead of scrolling into view. Focusable so the
                    scroll is reachable from the keyboard alone. */}
                <Card.Body
                  paddingY={0}
                  paddingX={0}
                  overflowX="auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Budgets table"
                >
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
                                gateway returns HTTP 402 and refuses to dispatch
                                once the limit is crossed.
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
                        const pct =
                          limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                        // Per-person templates report a headcount, not a
                        // total. Nobody seen yet is "0 of 0", which is true,
                        // rather than a dash that reads as broken.
                        const seatsSeen = b.endUsersSeen ?? 0;
                        const seatsOver = b.endUsersOver ?? 0;
                        const seatsOverPct =
                          seatsSeen > 0 ? (seatsOver / seatsSeen) * 100 : 0;
                        return (
                          <Table.Row
                            key={b.id}
                            cursor="pointer"
                            _hover={{ bg: "bg.subtle" }}
                            onClick={() =>
                              void router.push(`/gateway/budgets/${b.id}`)
                            }
                          >
                            <Table.Cell>
                              <VStack align="start" gap={0}>
                                <Link href={`/gateway/budgets/${b.id}`}>
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
                              <VStack align="start" gap={1}>
                                <ScopeCell
                                  scopeType={b.scopeType}
                                  scopeTarget={b.scopeTarget ?? null}
                                  providerLabel={b.providerLabel ?? null}
                                />
                                {b.unreachableByAnyKey && (
                                  <Tooltip content="Traffic is attributed to the project a key is scoped to. No active key is scoped so that its traffic reaches this budget, so it will stay at zero and never stop a request.">
                                    <Badge
                                      colorPalette="orange"
                                      variant="subtle"
                                      fontSize="2xs"
                                      data-testid="budget-unreachable-badge"
                                    >
                                      <TriangleAlert size={10} /> No key sends
                                      traffic here
                                    </Badge>
                                  </Tooltip>
                                )}
                              </VStack>
                            </Table.Cell>
                            <Table.Cell>
                              <Badge variant="subtle" colorPalette="gray">
                                {b.window.toLowerCase()}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell minWidth="220px">
                              {!b.spendAvailable ? (
                                <HStack fontSize="xs">
                                  <Text color="fg.muted">Unavailable</Text>
                                  <Text color="fg.muted">
                                    / {formatBudgetUsd(limit)}
                                  </Text>
                                </HStack>
                              ) : b.scopeType === "GROUP" ? (
                                // A group budget is one allowance per member;
                                // the only number the list can total is everyone's
                                // spend together, so it is labelled as exactly
                                // that. Per-member standing lives on the detail
                                // page and in the key drawer's applies list.
                                <VStack
                                  align="stretch"
                                  gap={0.5}
                                  data-testid="budget-group-spend"
                                >
                                  <HStack fontSize="xs" gap={1}>
                                    <Text fontWeight="medium">
                                      {formatBudgetUsd(spent)}
                                    </Text>
                                    <Text color="fg.muted">group total</Text>
                                  </HStack>
                                  <Text fontSize="2xs" color="fg.muted">
                                    {formatBudgetUsd(limit)} per member
                                    {typeof b.scopeTarget?.memberCount ===
                                    "number"
                                      ? ` · ${b.scopeTarget.memberCount} ${
                                          b.scopeTarget.memberCount === 1
                                            ? "member"
                                            : "members"
                                        }`
                                      : ""}
                                  </Text>
                                </VStack>
                              ) : b.scopeType === "ATTRIBUTED_USER" ? (
                                // A per-person template is one allowance per
                                // end user, so there is no single total to
                                // measure anyone against. What the list can
                                // say honestly is the cap each person carries
                                // and how many of them have passed it.
                                <VStack
                                  align="stretch"
                                  gap={1}
                                  data-testid="budget-attributed-user-spend"
                                >
                                  <HStack fontSize="xs" gap={1}>
                                    <Text fontWeight="medium">
                                      {formatBudgetUsd(limit)}
                                    </Text>
                                    <Text color="fg.muted">per person</Text>
                                  </HStack>
                                  <Text fontSize="2xs" color="fg.muted">
                                    {seatsOver} of {seatsSeen} people over cap
                                  </Text>
                                  <Progress.Root
                                    value={seatsOverPct}
                                    size="xs"
                                    colorPalette={
                                      seatsOver > 0 ? "red" : "green"
                                    }
                                  >
                                    <Progress.Track>
                                      <Progress.Range />
                                    </Progress.Track>
                                  </Progress.Root>
                                </VStack>
                              ) : (
                                <VStack align="stretch" gap={1}>
                                  <HStack fontSize="xs">
                                    <Text fontWeight="medium">
                                      {formatBudgetUsd(spent)}
                                    </Text>
                                    <Text color="fg.muted">
                                      / {formatBudgetUsd(limit)}
                                    </Text>
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
                                      pct >= 100
                                        ? "red"
                                        : pct >= 80
                                          ? "orange"
                                          : "green"
                                    }
                                  >
                                    <Progress.Track>
                                      <Progress.Range />
                                    </Progress.Track>
                                  </Progress.Root>
                                </VStack>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <Badge
                                colorPalette={
                                  b.onBreach === "BLOCK" ? "red" : "yellow"
                                }
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
                                  content={new Date(
                                    b.resetsAt,
                                  ).toLocaleString()}
                                >
                                  <Text fontSize="xs">
                                    {formatTimeAgo(
                                      new Date(b.resetsAt).getTime(),
                                    )}
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
                                        `/gateway/budgets/${b.id}`,
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
            </VStack>
          )}
        </Box>
      </>

      {organization?.id && (
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
    </AiGatewayLayout>
  );
}

type ScopeTarget = {
  kind: string;
  id: string;
  name: string;
  secondary?: string | null;
  projectSlug?: string | null;
  memberCount?: number;
};

/**
 * The one detail line the chip's tooltip carries: whatever identifies the
 * target beyond its name (a slug, a key prefix) plus, for a group, how
 * many people the limit is handed to.
 */
export function scopeChipDetail(
  scopeTarget: ScopeTarget | null,
): string | undefined {
  if (!scopeTarget) return undefined;
  const parts: string[] = [];
  if (scopeTarget.secondary) parts.push(scopeTarget.secondary);
  if (typeof scopeTarget.memberCount === "number") {
    parts.push(
      `${scopeTarget.memberCount} ${
        scopeTarget.memberCount === 1 ? "member" : "members"
      }`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * One line: the same scope chip every other settings surface renders,
 * plus the qualifiers that change what the limit means. A virtual-key
 * target links to that key.
 */
function ScopeCell({
  scopeType,
  scopeTarget,
  providerLabel,
}: {
  scopeType: string;
  scopeTarget: ScopeTarget | null;
  providerLabel?: string | null;
}) {
  return (
    <HStack gap={1} wrap="wrap">
      <ProviderScopeChips
        scopes={[
          {
            scopeType: scopeType as ProviderScopeType,
            scopeId: scopeTarget?.id ?? "",
            name: scopeTarget?.name,
            detail: scopeChipDetail(scopeTarget),
            href:
              scopeTarget && scopeType === "VIRTUAL_KEY"
                ? `/gateway/virtual-keys/${scopeTarget.id}`
                : undefined,
          },
        ]}
      />
      {scopeType === "GROUP" && (
        <Tooltip content="Each member of the group gets this limit individually.">
          <Badge
            colorPalette="cyan"
            variant="subtle"
            data-testid="budget-per-member-badge"
          >
            per member
          </Badge>
        </Tooltip>
      )}
      {providerLabel && (
        <Tooltip content="Only spend dispatched to this provider counts toward this budget.">
          <Badge
            colorPalette="blue"
            variant="subtle"
            data-testid="budget-provider-badge"
          >
            {providerLabel} only
          </Badge>
        </Tooltip>
      )}
    </HStack>
  );
}

export default withPermissionGuard("gatewayBudgets:view", {
  layoutComponent: AiGatewayLayout,
})(BudgetsPage);

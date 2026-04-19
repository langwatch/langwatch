import {
  Badge,
  Box,
  Button,
  Code,
  EmptyState,
  HStack,
  Heading,
  Progress,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, ArrowLeft, Pencil, Receipt } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { BudgetEditDrawer } from "~/components/gateway/BudgetEditDrawer";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { Link } from "~/components/ui/link";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

function BudgetDetailPage() {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const budgetId = typeof router.query.id === "string" ? router.query.id : "";

  const detailQuery = api.gatewayBudgets.get.useQuery(
    { organizationId: organization?.id ?? "", id: budgetId },
    { enabled: !!organization?.id && !!budgetId },
  );
  const utils = api.useContext();
  const archiveMutation = api.gatewayBudgets.archive.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayBudgets.list.invalidate({
          organizationId: organization.id,
        });
        await utils.gatewayBudgets.get.invalidate({
          organizationId: organization.id,
          id: budgetId,
        });
      }
    },
  });

  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const canUpdate = hasPermission("gatewayBudgets:update");
  const canDelete = hasPermission("gatewayBudgets:delete");

  const budget = detailQuery.data;

  const confirmArchive = async () => {
    if (!budget || !organization) return;
    try {
      await archiveMutation.mutateAsync({
        organizationId: organization.id,
        id: budget.id,
      });
      setArchiving(false);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to archive",
        type: "error",
      });
    }
  };

  const spent = budget ? Number.parseFloat(budget.spentUsd) : 0;
  const limit = budget ? Number.parseFloat(budget.limitUsd) : 0;
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const isArchived = !!budget?.archivedAt;

  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <HStack>
            <Link
              href={`/${project?.slug}/gateway/budgets`}
              color="fg.muted"
              fontSize="sm"
            >
              <HStack gap={1}>
                <ArrowLeft size={14} /> Budgets
              </HStack>
            </Link>
          </HStack>
          <PageLayout.Heading>
            {budget?.name ?? "Budget"}
            {isArchived && (
              <Badge colorPalette="gray" ml={2}>
                archived
              </Badge>
            )}
          </PageLayout.Heading>
          <Spacer />
          {budget && !isArchived && (
            <HStack>
              {canUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} /> Edit
                </Button>
              )}
              {canDelete && (
                <Button
                  colorPalette="red"
                  variant="outline"
                  size="sm"
                  onClick={() => setArchiving(true)}
                >
                  <Archive size={14} /> Archive
                </Button>
              )}
            </HStack>
          )}
        </PageLayout.Header>

        <Box padding={6}>
          {detailQuery.isLoading ? (
            <Spinner />
          ) : !budget ? (
            <Text color="fg.muted">Budget not found.</Text>
          ) : (
            <VStack align="stretch" gap={6} maxWidth="960px">
              <Section title="Utilization">
                <VStack align="stretch" gap={2}>
                  <HStack>
                    <Text fontWeight="medium" fontSize="2xl">
                      ${spent.toFixed(2)}
                    </Text>
                    <Text color="fg.muted">/ ${limit.toFixed(2)}</Text>
                    <Spacer />
                    <Badge
                      colorPalette={
                        pct >= 100 ? "red" : pct >= 80 ? "orange" : "green"
                      }
                    >
                      {pct.toFixed(1)}% used
                    </Badge>
                  </HStack>
                  <Progress.Root
                    value={pct}
                    size="sm"
                    colorPalette={
                      pct >= 100 ? "red" : pct >= 80 ? "orange" : "green"
                    }
                  >
                    <Progress.Track>
                      <Progress.Range />
                    </Progress.Track>
                  </Progress.Root>
                  <HStack fontSize="xs" color="fg.muted">
                    <Text>
                      Window: <strong>{budget.window.toLowerCase()}</strong>
                    </Text>
                    <Text>·</Text>
                    <Text>
                      Resets:{" "}
                      <strong>
                        {budget.window === "TOTAL"
                          ? "never"
                          : new Date(budget.resetsAt).toLocaleString()}
                      </strong>
                    </Text>
                    <Text>·</Text>
                    <Text>
                      On breach:{" "}
                      <strong>{budget.onBreach.toLowerCase()}</strong>
                    </Text>
                  </HStack>
                </VStack>
              </Section>

              <Section title="Identity">
                <DetailRow label="ID">
                  <Code fontSize="xs">{budget.id}</Code>
                </DetailRow>
                {budget.description && (
                  <DetailRow label="Description">
                    <Text fontSize="sm">{budget.description}</Text>
                  </DetailRow>
                )}
                <DetailRow label="Scope">
                  <ScopeBadge
                    target={budget.scopeTarget}
                    projectSlug={project?.slug ?? null}
                  />
                </DetailRow>
                <DetailRow label="Created">
                  <Text fontSize="sm" color="fg.muted">
                    {new Date(budget.createdAt).toLocaleString()}
                  </Text>
                </DetailRow>
                {budget.lastResetAt && (
                  <DetailRow label="Last reset">
                    <Text fontSize="sm" color="fg.muted">
                      {new Date(budget.lastResetAt).toLocaleString()}
                    </Text>
                  </DetailRow>
                )}
                {budget.timezone && (
                  <DetailRow label="Timezone">
                    <Code fontSize="xs">{budget.timezone}</Code>
                  </DetailRow>
                )}
              </Section>

              <Section title="Recent debits">
                {budget.recentLedger.length === 0 ? (
                  <EmptyState.Root size="sm">
                    <EmptyState.Content>
                      <EmptyState.Indicator>
                        <Receipt size={24} />
                      </EmptyState.Indicator>
                      <EmptyState.Title>No debits yet</EmptyState.Title>
                      <EmptyState.Description>
                        Debits land here once the gateway writes the outbox
                        ledger after a completed request against a VK in this
                        scope.
                      </EmptyState.Description>
                    </EmptyState.Content>
                  </EmptyState.Root>
                ) : (
                  <Table.Root size="sm">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>When</Table.ColumnHeader>
                        <Table.ColumnHeader>Virtual key</Table.ColumnHeader>
                        <Table.ColumnHeader>Model</Table.ColumnHeader>
                        <Table.ColumnHeader>Amount</Table.ColumnHeader>
                        <Table.ColumnHeader>Status</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {budget.recentLedger.map((line) => (
                        <Table.Row key={line.id}>
                          <Table.Cell>
                            <Text fontSize="xs" color="fg.muted">
                              {new Date(line.occurredAt).toLocaleString()}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Link
                              href={`/${project?.slug}/gateway/virtual-keys/${line.virtualKeyId}`}
                              color="orange.600"
                            >
                              <Text fontSize="sm">{line.virtualKeyName}</Text>
                            </Link>
                          </Table.Cell>
                          <Table.Cell>
                            <Code fontSize="xs">{line.model}</Code>
                          </Table.Cell>
                          <Table.Cell>
                            ${Number(line.amountUsd).toFixed(6)}
                          </Table.Cell>
                          <Table.Cell>
                            <StatusBadge status={line.status} />
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                )}
                <Text fontSize="xs" color="fg.muted" mt={1}>
                  Most recent 20 debits. Full history lives on the outbox
                  ledger — query via Usage for aggregates.
                </Text>
              </Section>
            </VStack>
          )}
        </Box>
      </PageLayout.Container>

      <BudgetEditDrawer
        budget={editing && budget ? budget : null}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
        onSaved={() => {
          setEditing(false);
          void detailQuery.refetch();
        }}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${budget?.name ?? "budget"}?`}
        message="Debits against this budget stop counting. The historical ledger is preserved but new requests route as if the budget didn't exist."
        confirmLabel="Archive"
        tone="warning"
        loading={archiveMutation.isPending}
        onConfirm={confirmArchive}
      />
    </GatewayLayout>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Heading size="sm" mb={2}>
        {title}
      </Heading>
      <Separator mb={3} />
      <VStack align="stretch" gap={2}>
        {children}
      </VStack>
    </Box>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <HStack gap={4} align="flex-start">
      <Text fontSize="sm" color="fg.muted" minWidth="140px">
        {label}
      </Text>
      {children}
    </HStack>
  );
}

type ScopeTarget =
  | { kind: "ORGANIZATION"; id: string; name: string; secondary: string | null }
  | { kind: "TEAM"; id: string; name: string; secondary: string | null }
  | { kind: "PROJECT"; id: string; name: string; secondary: string | null }
  | {
      kind: "VIRTUAL_KEY";
      id: string;
      name: string;
      secondary: string | null;
      projectSlug: string | null;
    }
  | { kind: "PRINCIPAL"; id: string; name: string; secondary: string | null };

function ScopeBadge({
  target,
  projectSlug,
}: {
  target: ScopeTarget;
  projectSlug: string | null;
}) {
  const kindLabel = target.kind.toLowerCase().replace("_", " ");
  const vkHref =
    target.kind === "VIRTUAL_KEY"
      ? `/${target.projectSlug ?? projectSlug ?? ""}/gateway/virtual-keys/${target.id}`
      : null;
  return (
    <HStack gap={2} align="baseline">
      <Badge colorPalette="gray">{kindLabel}</Badge>
      {vkHref ? (
        <Link href={vkHref} color="orange.600">
          <Text fontSize="sm" fontWeight="medium">
            {target.name}
          </Text>
        </Link>
      ) : (
        <Text fontSize="sm" fontWeight="medium">
          {target.name}
        </Text>
      )}
      {target.secondary && (
        <Code fontSize="xs" color="fg.muted">
          {target.secondary}
        </Code>
      )}
    </HStack>
  );
}

function StatusBadge({
  status,
}: {
  status: "SUCCESS" | "PROVIDER_ERROR" | "BLOCKED_BY_GUARDRAIL" | "CANCELLED";
}) {
  const palette =
    status === "SUCCESS"
      ? "green"
      : status === "BLOCKED_BY_GUARDRAIL"
        ? "red"
        : status === "PROVIDER_ERROR"
          ? "orange"
          : "gray";
  return <Badge colorPalette={palette}>{status.toLowerCase()}</Badge>;
}

export default withPermissionGuard("gatewayBudgets:view", {
  layoutComponent: DashboardLayout,
})(BudgetDetailPage);

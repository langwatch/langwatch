import {
  Badge,
  Box,
  Button,
  Code,
  EmptyState,
  HStack,
  IconButton,
  NativeSelect,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, FileClock, RefreshCw } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { Link } from "~/components/ui/link";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type AuditAction =
  | "VIRTUAL_KEY_CREATED"
  | "VIRTUAL_KEY_UPDATED"
  | "VIRTUAL_KEY_ROTATED"
  | "VIRTUAL_KEY_REVOKED"
  | "VIRTUAL_KEY_DELETED"
  | "BUDGET_CREATED"
  | "BUDGET_UPDATED"
  | "BUDGET_DELETED"
  | "PROVIDER_BINDING_CREATED"
  | "PROVIDER_BINDING_UPDATED"
  | "PROVIDER_BINDING_DELETED";

type TargetKind = "virtual_key" | "budget" | "provider_binding";

const ACTION_OPTIONS: Array<{ label: string; value: AuditAction | "" }> = [
  { label: "All actions", value: "" },
  { label: "VK created", value: "VIRTUAL_KEY_CREATED" },
  { label: "VK updated", value: "VIRTUAL_KEY_UPDATED" },
  { label: "VK rotated", value: "VIRTUAL_KEY_ROTATED" },
  { label: "VK revoked", value: "VIRTUAL_KEY_REVOKED" },
  { label: "VK deleted", value: "VIRTUAL_KEY_DELETED" },
  { label: "Budget created", value: "BUDGET_CREATED" },
  { label: "Budget updated", value: "BUDGET_UPDATED" },
  { label: "Budget deleted", value: "BUDGET_DELETED" },
  { label: "Provider binding created", value: "PROVIDER_BINDING_CREATED" },
  { label: "Provider binding updated", value: "PROVIDER_BINDING_UPDATED" },
  { label: "Provider binding deleted", value: "PROVIDER_BINDING_DELETED" },
];

const TARGET_OPTIONS: Array<{ label: string; value: TargetKind | "" }> = [
  { label: "All targets", value: "" },
  { label: "Virtual key", value: "virtual_key" },
  { label: "Budget", value: "budget" },
  { label: "Provider binding", value: "provider_binding" },
];

function AuditLogPage() {
  const { organization, project } = useOrganizationTeamProject();
  const [action, setAction] = useState<AuditAction | "">("");
  const [targetKind, setTargetKind] = useState<TargetKind | "">("");

  const listQuery = api.gatewayAudit.list.useInfiniteQuery(
    {
      organizationId: organization?.id ?? "",
      action: action || undefined,
      targetKind: targetKind || undefined,
      limit: 50,
    },
    {
      enabled: !!organization?.id,
      getNextPageParam: (last) => last.nextCursor,
    },
  );

  const entries = (listQuery.data?.pages ?? []).flatMap((p) => p.entries);

  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Audit log</PageLayout.Heading>
          <Spacer />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => listQuery.refetch()}
            loading={listQuery.isFetching}
          >
            <RefreshCw size={14} /> Refresh
          </Button>
        </PageLayout.Header>

        <Box padding={6}>
          <HStack gap={3} mb={4}>
            <Box>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={action}
                  onChange={(e) =>
                    setAction(e.target.value as AuditAction | "")
                  }
                >
                  {ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Box>
            <Box>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={targetKind}
                  onChange={(e) =>
                    setTargetKind(e.target.value as TargetKind | "")
                  }
                >
                  {TARGET_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Box>
          </HStack>

          {listQuery.isLoading ? (
            <Spinner />
          ) : entries.length === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <FileClock size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No matching audit entries</EmptyState.Title>
                <EmptyState.Description>
                  Audit entries are written in the same transaction as every
                  gateway mutation — VK create/update/rotate/revoke, budget
                  CRUD, provider binding changes. Once anyone touches those
                  resources they show up here.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <VStack align="stretch" gap={3}>
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader width="32px"></Table.ColumnHeader>
                    <Table.ColumnHeader>When</Table.ColumnHeader>
                    <Table.ColumnHeader>Actor</Table.ColumnHeader>
                    <Table.ColumnHeader>Action</Table.ColumnHeader>
                    <Table.ColumnHeader>Target</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {entries.map((entry) => (
                    <AuditRow
                      key={entry.id}
                      entry={entry}
                      projectSlug={project?.slug ?? ""}
                    />
                  ))}
                </Table.Body>
              </Table.Root>
              {listQuery.hasNextPage && (
                <HStack justify="center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => listQuery.fetchNextPage()}
                    loading={listQuery.isFetchingNextPage}
                  >
                    Load 50 more
                  </Button>
                </HStack>
              )}
            </VStack>
          )}
        </Box>
      </PageLayout.Container>
    </GatewayLayout>
  );
}

type AuditEntry = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: AuditAction;
  targetKind: string;
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

function AuditRow({
  entry,
  projectSlug,
}: {
  entry: AuditEntry;
  projectSlug: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const targetHref = resolveTargetHref(
    entry.targetKind,
    entry.targetId,
    projectSlug,
  );
  return (
    <>
      <Table.Row>
        <Table.Cell>
          <IconButton
            aria-label={expanded ? "Collapse" : "Expand"}
            size="xs"
            variant="ghost"
            onClick={() => setExpanded((s) => !s)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
        </Table.Cell>
        <Table.Cell>
          <Text fontSize="xs" color="fg.muted">
            {new Date(entry.createdAt).toLocaleString()}
          </Text>
        </Table.Cell>
        <Table.Cell>
          {entry.actorName || entry.actorEmail ? (
            <VStack align="start" gap={0}>
              {entry.actorName && (
                <Text fontSize="sm">{entry.actorName}</Text>
              )}
              {entry.actorEmail && (
                <Text fontSize="xs" color="fg.muted">
                  {entry.actorEmail}
                </Text>
              )}
            </VStack>
          ) : (
            <Text fontSize="xs" color="fg.muted">
              system / api token
            </Text>
          )}
        </Table.Cell>
        <Table.Cell>
          <ActionBadge action={entry.action} />
        </Table.Cell>
        <Table.Cell>
          <HStack gap={2}>
            <Badge colorPalette="gray" fontSize="2xs">
              {entry.targetKind.replace("_", " ")}
            </Badge>
            {targetHref ? (
              <Link href={targetHref} color="orange.600">
                <Code fontSize="xs">{entry.targetId}</Code>
              </Link>
            ) : (
              <Code fontSize="xs">{entry.targetId}</Code>
            )}
          </HStack>
        </Table.Cell>
      </Table.Row>
      {expanded && (
        <Table.Row>
          <Table.Cell colSpan={5} background="bg.subtle">
            <HStack align="stretch" gap={4} padding={2}>
              <JsonPanel label="Before" value={entry.before} />
              <JsonPanel label="After" value={entry.after} />
            </HStack>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}

function JsonPanel({ label, value }: { label: string; value: unknown }) {
  const text =
    value === null || value === undefined
      ? "—"
      : JSON.stringify(value, null, 2);
  return (
    <VStack
      flex={1}
      align="stretch"
      gap={1}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      padding={2}
      background="white"
    >
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        {label}
      </Text>
      <Box
        as="pre"
        fontSize="xs"
        fontFamily="mono"
        overflow="auto"
        maxHeight="320px"
        whiteSpace="pre-wrap"
      >
        {text}
      </Box>
    </VStack>
  );
}

function ActionBadge({ action }: { action: AuditAction }) {
  const palette =
    action.endsWith("DELETED") || action.endsWith("REVOKED")
      ? "red"
      : action.endsWith("CREATED") || action.endsWith("ROTATED")
        ? "green"
        : "blue";
  const label = action.toLowerCase().replace(/_/g, " ");
  return (
    <Badge colorPalette={palette} fontSize="2xs">
      {label}
    </Badge>
  );
}

function resolveTargetHref(
  kind: string,
  id: string,
  projectSlug: string,
): string | null {
  if (!projectSlug) return null;
  switch (kind) {
    case "virtual_key":
      return `/${projectSlug}/gateway/virtual-keys/${id}`;
    case "budget":
      return `/${projectSlug}/gateway/budgets/${id}`;
    case "provider_binding":
      return `/${projectSlug}/gateway/providers`;
    default:
      return null;
  }
}

export default withPermissionGuard("gatewayLogs:view", {
  layoutComponent: DashboardLayout,
})(AuditLogPage);

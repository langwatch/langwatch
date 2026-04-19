import {
  Badge,
  Box,
  Button,
  Card,
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
import { ChevronDown, ChevronRight, FileClock } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { Link } from "~/components/ui/link";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

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
  | "PROVIDER_BINDING_DELETED"
  | "CACHE_RULE_CREATED"
  | "CACHE_RULE_UPDATED"
  | "CACHE_RULE_DELETED";

type TargetKind = "virtual_key" | "budget" | "provider_binding" | "cache_rule";

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
  { label: "Cache rule created", value: "CACHE_RULE_CREATED" },
  { label: "Cache rule updated", value: "CACHE_RULE_UPDATED" },
  { label: "Cache rule deleted", value: "CACHE_RULE_DELETED" },
];

const TARGET_OPTIONS: Array<{ label: string; value: TargetKind | "" }> = [
  { label: "All targets", value: "" },
  { label: "Virtual key", value: "virtual_key" },
  { label: "Budget", value: "budget" },
  { label: "Provider binding", value: "provider_binding" },
  { label: "Cache rule", value: "cache_rule" },
];

function AuditLogPage() {
  const { organization, project } = useOrganizationTeamProject();
  const router = useRouter();
  // URL-seeded filter for deep-links from detail pages, e.g.
  // /gateway/audit?targetKind=virtual_key&targetId=vk_xxx. Users
  // clear it via the "Clear filter" button inline with the header.
  const urlTargetKind =
    typeof router.query.targetKind === "string"
      ? (router.query.targetKind as TargetKind)
      : "";
  const urlTargetId =
    typeof router.query.targetId === "string" ? router.query.targetId : "";
  const [action, setAction] = useState<AuditAction | "">("");
  const [targetKind, setTargetKind] = useState<TargetKind | "">(urlTargetKind);
  const [targetId, setTargetId] = useState(urlTargetId);

  const listQuery = api.gatewayAudit.list.useInfiniteQuery(
    {
      organizationId: organization?.id ?? "",
      action: action || undefined,
      targetKind: targetKind || undefined,
      targetId: targetId || undefined,
      limit: 50,
    },
    {
      enabled: !!organization?.id,
      getNextPageParam: (last) => last.nextCursor,
    },
  );

  const clearTarget = () => {
    setTargetKind("");
    setTargetId("");
    const { targetKind: _tk, targetId: _tid, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: rest });
  };

  const entries = (listQuery.data?.pages ?? []).flatMap((p) => p.entries);

  return (
    <GatewayLayout>
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Audit log</PageLayout.Heading>
          <Spacer />
        </PageLayout.Header>

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
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
                  onChange={(e) => {
                    setTargetKind(e.target.value as TargetKind | "");
                    if (!e.target.value) setTargetId("");
                  }}
                >
                  {TARGET_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Box>
            {targetId && (
              <Badge
                colorPalette="orange"
                variant="surface"
                gap={1}
                cursor="pointer"
                onClick={clearTarget}
                title="Clear target filter"
              >
                target = {targetId.slice(0, 24)}… ×
              </Badge>
            )}
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
              <Card.Root width="full" overflow="hidden">
                <Card.Body paddingY={0} paddingX={0}>
              <Table.Root variant="line" size="md" width="full">
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
                </Card.Body>
              </Card.Root>
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
      </>
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
          <Tooltip content={new Date(entry.createdAt).toLocaleString()}>
            <Text fontSize="xs" color="fg.muted">
              {formatTimeAgo(new Date(entry.createdAt).getTime())}
            </Text>
          </Tooltip>
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
              <Link href={targetHref}>
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
            <VStack align="stretch" gap={3} padding={2}>
              <DiffSummary before={entry.before} after={entry.after} />
              <HStack align="stretch" gap={4}>
                <JsonPanel label="Before" value={entry.before} />
                <JsonPanel label="After" value={entry.after} />
              </HStack>
            </VStack>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}

function DiffSummary({ before, after }: { before: unknown; after: unknown }) {
  const kind = diffKind(before, after);
  if (kind === "unsupported") return null;

  if (kind === "create") {
    const fields = flattenObject(after);
    if (fields.length === 0) return null;
    return (
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Created with {fields.length} field{fields.length === 1 ? "" : "s"}
        </Text>
        <VStack align="stretch" gap={0.5}>
          {fields.map(({ key, value }) => (
            <HStack key={key} gap={2} fontSize="xs" align="start">
              <Code fontSize="2xs" minWidth="140px" flexShrink={0}>
                {key}
              </Code>
              <Code
                fontSize="2xs"
                colorPalette="green"
                variant="surface"
                maxWidth="80%"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {formatValue(value)}
              </Code>
            </HStack>
          ))}
        </VStack>
      </VStack>
    );
  }

  if (kind === "delete") {
    const fields = flattenObject(before);
    if (fields.length === 0) return null;
    return (
      <Text fontSize="xs" color="fg.muted">
        Deleted ({fields.length} field{fields.length === 1 ? "" : "s"} removed —
        see Before pane below).
      </Text>
    );
  }

  // update: both sides objects.
  const changes = computeShallowDiff(before, after) ?? [];
  if (changes.length === 0) {
    return (
      <Text fontSize="xs" color="fg.muted">
        No field changes at the top level (nested fields may still differ — see
        Before/After below).
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Changed fields ({changes.length})
      </Text>
      <VStack align="stretch" gap={0.5}>
        {changes.map(({ key, before: b, after: a }) => (
          <HStack key={key} gap={2} fontSize="xs" align="start">
            <Code fontSize="2xs" minWidth="140px" flexShrink={0}>
              {key}
            </Code>
            <Code
              fontSize="2xs"
              colorPalette="red"
              variant="surface"
              maxWidth="40%"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {formatValue(b)}
            </Code>
            <Text color="fg.muted">→</Text>
            <Code
              fontSize="2xs"
              colorPalette="green"
              variant="surface"
              maxWidth="40%"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {formatValue(a)}
            </Code>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

function diffKind(
  before: unknown,
  after: unknown,
): "create" | "delete" | "update" | "unsupported" {
  const beforeEmpty = before === null || before === undefined;
  const afterEmpty = after === null || after === undefined;
  if (beforeEmpty && afterEmpty) return "unsupported";
  if (beforeEmpty && isPlainObject(after)) return "create";
  if (afterEmpty && isPlainObject(before)) return "delete";
  if (isPlainObject(before) && isPlainObject(after)) return "update";
  return "unsupported";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function flattenObject(
  v: unknown,
): Array<{ key: string; value: unknown }> {
  if (!isPlainObject(v)) return [];
  return Object.entries(v).map(([key, value]) => ({ key, value }));
}

function computeShallowDiff(
  before: unknown,
  after: unknown,
): Array<{ key: string; before: unknown; after: unknown }> | null {
  if (
    before === null ||
    before === undefined ||
    after === null ||
    after === undefined
  ) {
    return null;
  }
  if (
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return null;
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  const changes: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    // Cheap stringify compare — not ideal for deep object equality, but
    // matches the 'did this top-level field change' question we care about.
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      changes.push({ key, before: bv, after: av });
    }
  }
  return changes;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
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
    case "cache_rule":
      return `/${projectSlug}/gateway/cache-rules`;
    default:
      return null;
  }
}

export default withPermissionGuard("gatewayLogs:view", {
  layoutComponent: DashboardLayout,
})(AuditLogPage);

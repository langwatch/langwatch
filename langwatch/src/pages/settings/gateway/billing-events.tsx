import {
  Badge,
  Box,
  Button,
  EmptyState,
  Heading,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ReceiptText, X } from "lucide-react";
import { useMemo, useState } from "react";

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import { Tooltip as UITooltip } from "~/components/ui/tooltip";
import { createListCollection } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRollingWindow } from "~/hooks/useRollingWindow";
import { api, type RouterOutputs } from "~/utils/api";

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 24h", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
];

type SpendEventsPage = RouterOutputs["gatewaySpendEvents"]["list"];
type SpendRow = SpendEventsPage["rows"][number];
type Cursor = NonNullable<SpendEventsPage["nextCursor"]>;

const statusCollection = createListCollection({
  items: [
    { label: "All statuses", value: "all" },
    { label: "Confirmed", value: "confirmed" },
    { label: "Failed", value: "failed" },
    { label: "Admitted", value: "admitted" },
    { label: "Settled", value: "settled" },
  ],
});

function tokensSummary(row: SpendRow) {
  const parts = [`${row.tokensInput} in`, `${row.tokensOutput} out`];
  if (row.tokensCacheRead > 0) parts.push(`${row.tokensCacheRead} cr`);
  if (row.tokensCacheWrite > 0) parts.push(`${row.tokensCacheWrite} cw`);
  if (row.tokensReasoning > 0) parts.push(`${row.tokensReasoning} rsn`);
  return parts.join(" / ");
}

function formatCost(costUsd: string) {
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return costUsd;
  return `$${n.toFixed(n >= 0.01 ? 4 : 6)}`;
}

/**
 * The billing events ledger: the per-request `gateway_spend_events` table
 * rendered newest-first with keyset load-more. Every row is one gateway
 * request as billing sees it: token classes, rated cost, attribution, and
 * status, with a drill-through to the trace behind it.
 */
function BillingEventsPage() {
  const { project } = useOrganizationTeamProject();

  const [days, setDays] = useState<number>(7);
  const [virtualKeyFilter, setVirtualKeyFilter] = useState("");
  const [endUserFilter, setEndUserFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "confirmed" | "failed" | "admitted" | "settled">(
    "all",
  );
  const [pages, setPages] = useState<SpendRow[][]>([]);
  const [cursor, setCursor] = useState<Cursor | undefined>(undefined);

  const { fromIso, toIso } = useRollingWindow(days);
  const fromMs = useMemo(() => new Date(fromIso).getTime(), [fromIso]);
  const toMs = useMemo(() => new Date(toIso).getTime(), [toIso]);

  const resetPaging = () => {
    setPages([]);
    setCursor(undefined);
  };

  const query = api.gatewaySpendEvents.list.useQuery(
    {
      projectId: project?.id ?? "",
      fromMs,
      toMs,
      virtualKeyId: virtualKeyFilter || undefined,
      endUserId: endUserFilter || undefined,
      model: modelFilter || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      cursor,
      limit: 50,
    },
    {
      enabled: !!project?.id,
      keepPreviousData: true,
      onSuccess: (page) => {
        setPages((prev) =>
          cursor === undefined ? [page.rows] : [...prev, page.rows],
        );
      },
    },
  );

  const rows = useMemo(() => {
    if (pages.length === 0) return query.data?.rows ?? [];
    return pages.flat();
  }, [pages, query.data]);
  const names = query.data?.virtualKeyNames ?? {};
  const hasMore = query.data?.nextCursor != null;

  const filterInput = (
    value: string,
    set: (v: string) => void,
    placeholder: string,
    testId: string,
  ) => (
    <HStack gap={0}>
      <Input
        size="sm"
        width="160px"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => {
          set(e.target.value);
          resetPaging();
        }}
      />
      {value && (
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Clear ${placeholder}`}
          onClick={() => {
            set("");
            resetPaging();
          }}
        >
          <X size={12} />
        </Button>
      )}
    </HStack>
  );

  return (
    <VStack gap={6} width="full" align="start" paddingY={6} paddingX={6}>
      <HStack width="full" justify="space-between" flexWrap="wrap" gap={3}>
        <Heading size="lg">Billing Events</Heading>
        <HStack gap={2}>
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="xs"
              variant={days === preset.days ? "solid" : "outline"}
              onClick={() => {
                setDays(preset.days);
                resetPaging();
              }}
            >
              {preset.label}
            </Button>
          ))}
        </HStack>
      </HStack>

      <HStack gap={2} flexWrap="wrap">
        {filterInput(
          virtualKeyFilter,
          setVirtualKeyFilter,
          "Virtual key id",
          "filter-virtual-key",
        )}
        {filterInput(
          endUserFilter,
          setEndUserFilter,
          "End user id",
          "filter-end-user",
        )}
        {filterInput(modelFilter, setModelFilter, "Model", "filter-model")}
        <Select.Root
          collection={statusCollection}
          size="sm"
          width="140px"
          value={[statusFilter]}
          onValueChange={({ value }) => {
            setStatusFilter((value[0] as typeof statusFilter) ?? "all");
            resetPaging();
          }}
          data-testid="filter-status"
        >
          <Select.Trigger>
            <Select.ValueText />
          </Select.Trigger>
          <Select.Content>
            {statusCollection.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </HStack>

      {query.isLoading && <Spinner size="sm" />}

      {query.data?.clickHouseDisabled && (
        <Text fontSize="sm" color="fg.muted">
          Billing events need ClickHouse, which is not enabled on this
          deployment.
        </Text>
      )}

      {!query.isLoading && rows.length === 0 && !query.data?.clickHouseDisabled && (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <ReceiptText />
            </EmptyState.Indicator>
            <EmptyState.Title>No billing events</EmptyState.Title>
            <EmptyState.Description>
              Every gateway request lands here, budget or no budget.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      )}

      {rows.length > 0 && (
        <Box width="full" overflowX="auto">
          <Table.Root size="sm" data-testid="billing-events-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Time</Table.ColumnHeader>
                <Table.ColumnHeader>Request</Table.ColumnHeader>
                <Table.ColumnHeader>Virtual key</Table.ColumnHeader>
                <Table.ColumnHeader>End user</Table.ColumnHeader>
                <Table.ColumnHeader>Model</Table.ColumnHeader>
                <Table.ColumnHeader>Tokens</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="right">Cost</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.gatewayRequestId}>
                  <Table.Cell whiteSpace="nowrap">
                    {new Date(row.occurredAt).toLocaleString()}
                  </Table.Cell>
                  <Table.Cell>
                    {row.traceId && project ? (
                      <Link
                        href={`/${project.slug}/messages/${row.traceId}`}
                        fontFamily="mono"
                        fontSize="xs"
                      >
                        {row.gatewayRequestId.slice(0, 12)}
                      </Link>
                    ) : (
                      <Text fontFamily="mono" fontSize="xs">
                        {row.gatewayRequestId.slice(0, 12)}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {names[row.virtualKeyId] ?? row.virtualKeyId}
                  </Table.Cell>
                  <Table.Cell>{row.endUserId || ""}</Table.Cell>
                  <Table.Cell>
                    <HStack gap={1}>
                      <Text fontSize="sm">{row.model}</Text>
                      {row.providerKey && (
                        <Badge size="sm" colorPalette="gray">
                          {row.providerKey}
                        </Badge>
                      )}
                    </HStack>
                  </Table.Cell>
                  <Table.Cell whiteSpace="nowrap">
                    <UITooltip content="input / output / cache read / cache write / reasoning">
                      <Text fontSize="xs">{tokensSummary(row)}</Text>
                    </UITooltip>
                  </Table.Cell>
                  <Table.Cell textAlign="right" whiteSpace="nowrap">
                    {formatCost(row.costUsd)}
                  </Table.Cell>
                  <Table.Cell>
                    {row.status === "confirmed" ? (
                      <Badge size="sm" colorPalette="green">
                        confirmed
                      </Badge>
                    ) : row.status === "failed" ? (
                      <UITooltip
                        content={row.errorClass || `HTTP ${row.httpStatus}`}
                      >
                        <Badge size="sm" colorPalette="red">
                          failed
                        </Badge>
                      </UITooltip>
                    ) : row.status === "settled" ? (
                      <UITooltip content="Confirmation never arrived; cost unknown, flagged for reconciliation">
                        <Badge size="sm" colorPalette="yellow">
                          settled
                        </Badge>
                      </UITooltip>
                    ) : (
                      <Badge size="sm" colorPalette="gray">
                        admitted
                      </Badge>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      {hasMore && (
        <Button
          size="sm"
          variant="outline"
          loading={query.isFetching}
          onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
          data-testid="billing-events-load-more"
        >
          Load more
        </Button>
      )}
    </VStack>
  );
}

export default withPermissionGuard("gatewayUsage:view", {
  layoutComponent: AiGatewayLayout,
})(BillingEventsPage);

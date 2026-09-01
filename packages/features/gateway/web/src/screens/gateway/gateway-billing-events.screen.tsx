import {
  Badge,
  Box,
  Button,
  createListCollection,
  EmptyState,
  Heading,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { keepPreviousData } from "../../model/keep-previous-data";
import { ReceiptText, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AiGatewayLayout from "../../ui/sections/gateway-layout";
import { Link } from "../../ui/elements/gateway-link";
import { Select } from "@langwatch/design-system/select";
import { Tooltip as UITooltip } from "@langwatch/design-system/tooltip";
import { useOrganizationTeamProject } from "../../behavior/gateway-session";
import { useRollingWindow } from "../../behavior/use-rolling-window";
import { api, type RouterOutputs } from "../../behavior/gateway-api";

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 24h", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
];

type SpendEventsPage = RouterOutputs["gatewaySpendEvents"]["list"];
type SpendRow = SpendEventsPage["rows"][number];
type Cursor = NonNullable<SpendEventsPage["nextCursor"]>;
type StatusFilter = "all" | "confirmed" | "failed" | "admitted" | "settled";

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

/** A filter setter that starts the ledger over from a fresh first page. */
function resetsPaging<T>(set: (value: T) => void, reset: () => void) {
  return (value: T) => {
    set(value);
    reset();
  };
}

/** The window the presets pick, as the epoch milliseconds the query takes. */
function useWindowMs(days: number) {
  const { fromIso, toIso } = useRollingWindow(days);
  const fromMs = useMemo(() => new Date(fromIso).getTime(), [fromIso]);
  const toMs = useMemo(() => new Date(toIso).getTime(), [toIso]);
  return { fromMs, toMs };
}

/**
 * Keyset paging that accumulates: every loaded page is appended, and a page
 * loaded without a cursor is a first page that replaces what came before.
 */
function useLedgerPaging() {
  const [pages, setPages] = useState<SpendRow[][]>([]);
  const [cursor, setCursor] = useState<Cursor | undefined>(undefined);

  const reset = () => {
    setPages([]);
    setCursor(undefined);
  };

  const append = (page: SpendEventsPage) => {
    setPages((prev) => (cursor === undefined ? [page.rows] : [...prev, page.rows]));
  };

  return { pages, cursor, setCursor, reset, append };
}

/**
 * The ledger's filters and the page they select. Changing any filter resets
 * paging, so the next result is a fresh first page rather than an append.
 */
function useBillingEventsLedger(projectId: string) {
  const [days, setDays] = useState<number>(7);
  const [virtualKeyFilter, setVirtualKeyFilter] = useState("");
  const [endUserFilter, setEndUserFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const paging = useLedgerPaging();
  const { fromMs, toMs } = useWindowMs(days);

  const query = api.gatewaySpendEvents.list.useQuery(
    {
      projectId,
      fromMs,
      toMs,
      filters: {
        virtualKeyIds: virtualKeyFilter ? [virtualKeyFilter] : undefined,
        endUserIds: endUserFilter ? [endUserFilter] : undefined,
        models: modelFilter ? [modelFilter] : undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
      },
      cursor: paging.cursor,
      limit: 50,
    },
    {
      enabled: !!projectId,
      placeholderData: keepPreviousData,
    },
  );

  // Append per fetch, keyed on `dataUpdatedAt` so a cursor page that happens
  // to equal the previous one (identity held by structural sharing) still
  // lands exactly once per response.
  const { data: pageData, dataUpdatedAt } = query;
  useEffect(() => {
    if (dataUpdatedAt === 0 || !pageData) return;
    paging.append(pageData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);

  const rows = useMemo(() => {
    if (paging.pages.length === 0) return query.data?.rows ?? [];
    return paging.pages.flat();
  }, [paging.pages, query.data]);

  return {
    days,
    setDays: resetsPaging(setDays, paging.reset),
    virtualKey: virtualKeyFilter,
    setVirtualKey: resetsPaging(setVirtualKeyFilter, paging.reset),
    endUser: endUserFilter,
    setEndUser: resetsPaging(setEndUserFilter, paging.reset),
    model: modelFilter,
    setModel: resetsPaging(setModelFilter, paging.reset),
    status: statusFilter,
    setStatus: resetsPaging(setStatusFilter, paging.reset),
    query,
    rows,
    names: query.data?.virtualKeyNames ?? {},
    hasMore: query.data?.nextCursor != null,
    loadMore: () => paging.setCursor(query.data?.nextCursor ?? undefined),
  };
}

type Ledger = ReturnType<typeof useBillingEventsLedger>;

/** One text filter, with the button that clears it. */
function FilterInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <HStack gap={0}>
      <Input
        size="sm"
        width="160px"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Clear ${placeholder}`}
          onClick={() => onChange("")}
        >
          <X size={12} />
        </Button>
      )}
    </HStack>
  );
}

function PresetRangeButtons({
  days,
  onSelect,
}: {
  days: number;
  onSelect: (days: number) => void;
}) {
  return (
    <HStack gap={2}>
      {PRESETS.map((preset) => (
        <Button
          key={preset.label}
          size="xs"
          variant={days === preset.days ? "solid" : "outline"}
          onClick={() => onSelect(preset.days)}
        >
          {preset.label}
        </Button>
      ))}
    </HStack>
  );
}

function BillingEventFilters({ ledger }: { ledger: Ledger }) {
  return (
    <HStack gap={2} flexWrap="wrap">
      <FilterInput
        value={ledger.virtualKey}
        onChange={ledger.setVirtualKey}
        placeholder="Virtual key id"
        testId="filter-virtual-key"
      />
      <FilterInput
        value={ledger.endUser}
        onChange={ledger.setEndUser}
        placeholder="End user id"
        testId="filter-end-user"
      />
      <FilterInput
        value={ledger.model}
        onChange={ledger.setModel}
        placeholder="Model"
        testId="filter-model"
      />
      <Select.Root
        collection={statusCollection}
        size="sm"
        width="140px"
        value={[ledger.status]}
        onValueChange={({ value }) =>
          ledger.setStatus((value[0] as StatusFilter) ?? "all")
        }
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
  );
}

function NoBillingEventsState() {
  return (
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
  );
}

/** The row's billing status, with the reason behind the ones that need one. */
function SpendStatusBadge({ row }: { row: SpendRow }) {
  if (row.status === "confirmed") {
    return (
      <Badge size="sm" colorPalette="green">
        confirmed
      </Badge>
    );
  }
  if (row.status === "failed") {
    return (
      <UITooltip content={row.errorClass || `HTTP ${row.httpStatus}`}>
        <Badge size="sm" colorPalette="red">
          failed
        </Badge>
      </UITooltip>
    );
  }
  if (row.status === "settled") {
    return (
      <UITooltip content="Confirmation never arrived; cost unknown, flagged for reconciliation">
        <Badge size="sm" colorPalette="yellow">
          settled
        </Badge>
      </UITooltip>
    );
  }
  return (
    <Badge size="sm" colorPalette="gray">
      admitted
    </Badge>
  );
}

/** One gateway request as billing sees it, newest first in the ledger. */
function BillingEventRow({
  row,
  virtualKeyName,
  projectSlug,
}: {
  row: SpendRow;
  virtualKeyName: string | undefined;
  projectSlug: string | undefined;
}) {
  return (
    <Table.Row>
      <Table.Cell whiteSpace="nowrap">
        {new Date(row.occurredAt).toLocaleString()}
      </Table.Cell>
      <Table.Cell>
        {row.traceId && projectSlug ? (
          <Link
            href={`/${projectSlug}/traces/${row.traceId}`}
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
      <Table.Cell>{virtualKeyName ?? row.virtualKeyId}</Table.Cell>
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
        <SpendStatusBadge row={row} />
      </Table.Cell>
    </Table.Row>
  );
}

function BillingEventsTable({
  rows,
  names,
  projectSlug,
}: {
  rows: SpendRow[];
  names: SpendEventsPage["virtualKeyNames"];
  projectSlug: string | undefined;
}) {
  return (
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
            <BillingEventRow
              key={row.gatewayRequestId}
              row={row}
              virtualKeyName={names[row.virtualKeyId]}
              projectSlug={projectSlug}
            />
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

/**
 * The billing events ledger: the per-request `gateway_spend_events` table
 * rendered newest-first with keyset load-more. Every row is one gateway
 * request as billing sees it: token classes, rated cost, attribution, and
 * status, with a drill-through to the trace behind it.
 */
function BillingEventsPage() {
  const { project } = useOrganizationTeamProject();
  const ledger = useBillingEventsLedger(project?.id ?? "");

  return (
    <AiGatewayLayout>
      <VStack gap={6} width="full" align="start" paddingY={6} paddingX={6}>
        <HStack width="full" justify="space-between" flexWrap="wrap" gap={3}>
          <Heading size="lg">Billing Events</Heading>
          <PresetRangeButtons days={ledger.days} onSelect={ledger.setDays} />
        </HStack>

        <BillingEventFilters ledger={ledger} />

        {ledger.query.isLoading && <Spinner size="sm" />}

        {ledger.query.data?.clickHouseDisabled && (
          <Text fontSize="sm" color="fg.muted">
            Billing events need ClickHouse, which is not enabled on this deployment.
          </Text>
        )}

        {!ledger.query.isLoading &&
          ledger.rows.length === 0 &&
          !ledger.query.data?.clickHouseDisabled && <NoBillingEventsState />}

        {ledger.rows.length > 0 && (
          <BillingEventsTable
            rows={ledger.rows}
            names={ledger.names}
            projectSlug={project?.slug}
          />
        )}

        {ledger.hasMore && (
          <Button
            size="sm"
            variant="outline"
            loading={ledger.query.isFetching}
            onClick={ledger.loadMore}
            data-testid="billing-events-load-more"
          >
            Load more
          </Button>
        )}
      </VStack>
    </AiGatewayLayout>
  );
}

export default BillingEventsPage;

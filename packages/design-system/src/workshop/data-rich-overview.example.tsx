import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { Drawer } from "@langwatch/design-system/drawer";
import { FilterChips } from "@langwatch/design-system/filter-chips";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { MetricTabs } from "@langwatch/design-system/metric-tabs";
import { Money } from "@langwatch/design-system/money";
import { EmptyNextSteps, type EmptyNext } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Pagination } from "@langwatch/design-system/pagination";
import {
  Badge,
  Box,
  Button,
  Heading,
  Skeleton,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import {
  SelectionActionBar,
  type SelectionActionBarProps,
} from "@langwatch/design-system/selection-action-bar";
import {
  StatTile,
  StatTileFigure,
  StatTileGrid,
  StatTileSkeleton,
} from "@langwatch/design-system/stat-tile";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import { TableToolbar } from "@langwatch/design-system/table-toolbar";
import { TimeSeriesChart } from "@langwatch/design-system/time-series-chart";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { useRef, useState, type RefObject } from "react";

export type TraceStatus = "ok" | "slow" | "error";
export type StatusFilter = "all" | TraceStatus;
export type MetricKey = "requests" | "cost" | "latency";
export type SortKey = "time" | "cost";

/** One trace in the review table. Integer ids and fixed times keep the example deterministic. */
export interface Trace {
  id: number;
  name: string;
  status: TraceStatus;
  at: string;
  durationMs: number;
  costUsd: number;
  model: string;
}

export interface Sort {
  key: SortKey;
  direction: "asc" | "desc";
}

/** Your API's refresh of the traces: resolves when they are fresh, rejects when they are not. */
export type RefreshTraces = () => Promise<void>;

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface DataRichOverviewStart {
  metrics?: "loading" | "empty";
  traces?: "loading" | "error" | "empty";
  metric?: MetricKey;
  query?: string;
  status?: StatusFilter;
  page?: number;
  sort?: Sort;
  selected?: number[];
  refresh?: "refreshing" | "failed";
  openTrace?: number;
  exportTraces?: number[];
}

const DOCS = "https://docs.langwatch.ai/integration/overview";
const PAGE_SIZE = 10;
const PERIOD = "5 to 11 October 2026";
const TABLE_ID = "traces-table";
const NO_NEXT: EmptyNext = [{ kind: "docs", label: "Read about tracing", href: DOCS }];
const DEFAULT_SORT: Sort = { key: "time", direction: "desc" };

/** The week's totals by day: the tiles and every tab of the chart read from this one list. */
export const DAILY = [
  { label: "Mon 5 Oct", requests: 1180, costUsd: 4.96, errors: 6, p95Ms: 1840 },
  { label: "Tue 6 Oct", requests: 1260, costUsd: 5.41, errors: 5, p95Ms: 1790 },
  { label: "Wed 7 Oct", requests: 1420, costUsd: 6.12, errors: 11, p95Ms: 2310 },
  { label: "Thu 8 Oct", requests: 1310, costUsd: 5.58, errors: 7, p95Ms: 1920 },
  { label: "Fri 9 Oct", requests: 1240, costUsd: 5.29, errors: 6, p95Ms: 1870 },
  { label: "Sat 10 Oct", requests: 640, costUsd: 2.71, errors: 3, p95Ms: 1450 },
  { label: "Sun 11 Oct", requests: 560, costUsd: 2.35, errors: 2, p95Ms: 1380 },
];
type Day = (typeof DAILY)[number];

const TOTAL_REQUESTS = DAILY.reduce((sum, day) => sum + day.requests, 0);
const TOTAL_COST = DAILY.reduce((sum, day) => sum + day.costUsd, 0);
const TOTAL_ERRORS = DAILY.reduce((sum, day) => sum + day.errors, 0);
const AVERAGE_P95 = DAILY.reduce((sum, day) => sum + day.p95Ms, 0) / DAILY.length;

const TRACE_NAMES: [string, TraceStatus][] = [
  ["Refund for a late parcel", "ok"],
  ["Where is order 48213?", "ok"],
  ["Talk to a person, please", "error"],
  ["When will the blue jacket arrive?", "slow"],
  ["Cracked screen on delivery", "ok"],
  ["Cancel my monthly plan", "ok"],
  ["Change my delivery address", "error"],
  ["Is the kettle under warranty?", "slow"],
  ["Send me last month's invoice", "ok"],
  ["I can't reset my password", "ok"],
  ["Refund after a missed delivery", "slow"],
  ["Where is order 48307?", "error"],
  ["Delivery to a PO box", "ok"],
  ["Speak to the returns team", "ok"],
  ["Box arrived crushed", "error"],
  ["Pause my plan for a month", "slow"],
  ["Add a flat number to my address", "ok"],
  ["Warranty on a used phone", "ok"],
  ["Invoice shows the wrong VAT", "error"],
  ["Reset link never arrived", "ok"],
  ["Refund to a different card", "ok"],
  ["Where is order 48392?", "slow"],
  ["Deliver to my neighbour", "error"],
  ["Call me back about my order", "ok"],
  ["Wrong size in the parcel", "slow"],
  ["Cancel before the next charge", "ok"],
  ["Update my postcode", "ok"],
  ["Is accidental damage covered?", "error"],
  ["Invoice in euros, please", "slow"],
  ["Locked out after too many tries", "ok"],
];
const MODELS = ["gpt-5-mini", "claude-sonnet-5", "gpt-5"];
const SPREAD: Record<TraceStatus, { base: number; wobble: number }> = {
  ok: { base: 900, wobble: 1100 },
  slow: { base: 3200, wobble: 2200 },
  error: { base: 400, wobble: 700 },
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The nth latest trace is 137 minutes older than the one before it; the newest is 11 Oct 09:42. */
function timeOf({ index }: { index: number }): string {
  const minutes = 9 * 60 + 42 - index * 137;
  const dayShift = Math.floor(minutes / 1440);
  const minuteOfDay = minutes - dayShift * 1440;
  const hours = Math.floor(minuteOfDay / 60);
  return `2026-10-${pad(11 + dayShift)}T${pad(hours)}:${pad(minuteOfDay % 60)}`;
}

/** The latest traces, newest first: ids, times, durations and costs are formulas, not random. */
export const SEED_TRACES: Trace[] = TRACE_NAMES.map(([name, status], index) => {
  const id = index + 1;
  const { base, wobble } = SPREAD[status];
  return {
    id,
    name,
    status,
    at: timeOf({ index }),
    durationMs: base + ((id * 173) % wobble),
    costUsd: 0.002 + ((id * 37) % 90) / 10_000,
    model: MODELS[index % MODELS.length] ?? "gpt-5-mini",
  };
});

const STATUS = {
  ok: { label: "OK", palette: "green" },
  slow: { label: "Slow", palette: "orange" },
  error: { label: "Error", palette: "red" },
} as const;
const STATUS_VALUES: StatusFilter[] = ["all", "error", "slow", "ok"];
const STATUS_NAMES: Record<StatusFilter, string> = {
  all: "traces",
  error: "failed traces",
  slow: "slow traces",
  ok: "healthy traces",
};

const COLUMNS = [
  { value: "status", label: "Status" },
  { value: "time", label: "Time" },
  { value: "duration", label: "Duration" },
  { value: "cost", label: "Cost" },
  { value: "model", label: "Model" },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["value"];

const formatCount = ({ value }: { value: number }) => value.toLocaleString("en-US");
const formatRequests = ({ value }: { value: number }) => `${formatCount({ value })} requests`;
const formatDollars = ({ value }: { value: number }) => `$${value.toFixed(2)}`;
const formatDollarTick = ({ value }: { value: number }) => `$${Number(value.toFixed(2))}`;
const formatSeconds = ({ value }: { value: number }) => `${(value / 1000).toFixed(2)} s`;
const formatSecondTick = ({ value }: { value: number }) => `${(value / 1000).toFixed(1)} s`;
const formatAt = ({ at }: { at: string }) => `${Number(at.slice(8, 10))} Oct, ${at.slice(11, 16)}`;
const traceCode = ({ id }: { id: number }) => `trace-${String(id).padStart(3, "0")}`;
const countOf = ({ count }: { count: number }) => `${count} ${count === 1 ? "trace" : "traces"}`;

/** A stand-in for your API: succeeds straight away. Pass your own to call a real one. */
const refreshLocally: RefreshTraces = () => Promise.resolve();

const CSV_HEAD = "id,name,status,time,duration_ms,cost_usd,model";
const agentPrompt = () =>
  "Add LangWatch tracing to my support assistant so every conversation shows up as a trace with its model, cost and duration.";

function matchesQuery({ trace, query }: { trace: Trace; query: string }) {
  const text = `${trace.name} ${traceCode(trace)} ${trace.model}`.toLowerCase();
  return text.includes(query.trim().toLowerCase());
}

function ordered({ traces, sort }: { traces: Trace[]; sort: Sort }): Trace[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const read = (trace: Trace) => (sort.key === "time" ? trace.at : trace.costUsd);
  return traces.toSorted((a, b) => {
    const left = read(a);
    const right = read(b);
    if (left === right) return a.id - b.id;
    return left < right ? -sign : sign;
  });
}

type LoadState = "loading" | "error" | "empty" | "ready";
type Section = "loading" | "error" | "empty" | "no-results" | "ready";

function sectionOf({ load, rowCount }: { load: LoadState; rowCount: number }): Section {
  if (load !== "ready") return load;
  return rowCount === 0 ? "no-results" : "ready";
}

/** The select-all box reads the ticked rows of this page, not of the whole list. */
function pageTick({ rows, selected }: { rows: Trace[]; selected: ReadonlySet<number> }) {
  const ticked = rows.filter((trace) => selected.has(trace.id)).length;
  if (ticked === 0) return false;
  return ticked === rows.length ? true : "indeterminate";
}

function noMatchSentence({ query, status }: { query: string; status: StatusFilter }): string {
  const named = query.trim() ? ` for "${query.trim()}"` : "";
  const filter = status === "all" ? "" : ` with status ${STATUS[status].label}`;
  return `No traces${named}${filter}.`;
}

/** Ticked trace ids. They are kept by id, so sorting, paging and filtering never drop one. */
function useTicks({ initial }: { initial: number[] | undefined }) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set<number>(initial));
  return {
    selected,
    tick: ({ ids, on }: { ids: number[]; on: boolean }) =>
      setSelected((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    clearSelection: () => setSelected(new Set()),
  };
}

function useHiddenColumns() {
  const [hidden, setHidden] = useState<ReadonlySet<ColumnKey>>(new Set());
  return {
    shown: (column: ColumnKey) => !hidden.has(column),
    showColumn: ({ value, visible }: { value: string; visible: boolean }) => {
      const column = COLUMNS.find((known) => known.value === value)?.value;
      if (!column) return;
      setHidden((current) => {
        const next = new Set(current);
        if (visible) next.delete(column);
        else next.add(column);
        return next;
      });
    },
    resetColumns: () => setHidden(new Set()),
  };
}

/** The table's state and every change to it, so the pieces below only draw what it says. */
function useTraceTable({
  start,
  refresh,
}: {
  start: DataRichOverviewStart;
  refresh: RefreshTraces;
}) {
  const [load, setLoad] = useState<LoadState>(start.traces ?? "ready");
  const [refreshing, setRefreshing] = useState(start.refresh ?? "idle");
  const [query, setQuery] = useState(start.query ?? "");
  const [status, setStatus] = useState<StatusFilter>(start.status ?? "all");
  const [sort, setSort] = useState<Sort>(start.sort ?? DEFAULT_SORT);
  const [page, setPage] = useState(start.page ?? 1);
  const ticks = useTicks({ initial: start.selected });
  const columns = useHiddenColumns();

  const traces = load === "empty" ? [] : SEED_TRACES;
  const searched = traces.filter((trace) => matchesQuery({ trace, query }));
  const rows = ordered({
    traces: searched.filter((trace) => status === "all" || trace.status === status),
    sort,
  });
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const section = sectionOf({ load, rowCount: rows.length });

  const returnToFirstPage = (change: () => void) => {
    change();
    setPage(1);
  };

  const reload = async () => {
    const initial = load === "error";
    if (initial) setLoad("loading");
    else setRefreshing("refreshing");
    const failed = await refresh().then(
      () => false,
      () => true,
    );
    if (initial) setLoad(failed ? "error" : "ready");
    else setRefreshing(failed ? "failed" : "idle");
  };

  return {
    section,
    busy: section === "loading" || refreshing === "refreshing",
    refreshing,
    traces,
    searched,
    rows,
    pageRows,
    page,
    setPage,
    query,
    status,
    sort,
    ...ticks,
    ...columns,
    filtered: query.trim() !== "" || status !== "all",
    reload,
    changeQuery: (next: string) => returnToFirstPage(() => setQuery(next)),
    changeStatus: (next: string) =>
      returnToFirstPage(() => setStatus(STATUS_VALUES.find((known) => known === next) ?? "all")),
    clearFilters: () =>
      returnToFirstPage(() => {
        setQuery("");
        setStatus("all");
      }),
    toggleSort: (key: SortKey) =>
      returnToFirstPage(() =>
        setSort((current) => ({
          key,
          direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
        })),
      ),
  };
}

type TraceTableState = ReturnType<typeof useTraceTable>;

/**
 * A monitoring overview: stat tiles, a trend you switch between requests, cost and latency,
 * then the traces behind it with search, a status filter, sorting, paging and a selection that
 * can be exported. The application owns `refresh`, `onExport` and the real data.
 */
export function DataRichOverview({
  refresh = refreshLocally,
  onExport,
  selectionPlacement = "floating",
  start = {},
}: {
  refresh?: RefreshTraces;
  onExport?: (args: { traces: Trace[] }) => void;
  /** `inline` draws the selection bar as the toolbar's first band, for use inside an overlay. */
  selectionPlacement?: "floating" | "inline";
  start?: DataRichOverviewStart;
}) {
  const table = useTraceTable({ start, refresh });
  const [metric, setMetric] = useState<MetricKey>(start.metric ?? "requests");
  const [detail, setDetail] = useState({
    id: start.openTrace,
    open: start.openTrace !== undefined,
  });
  const [exporting, setExporting] = useState({
    ids: start.exportTraces ?? [],
    open: start.exportTraces !== undefined,
  });
  const opener = useRef<number | undefined>(undefined);
  const tableBox = useRef<HTMLDivElement>(null);

  const show = (trace: Trace) => {
    opener.current = trace.id;
    setDetail({ id: trace.id, open: true });
  };
  const exportTraces = (ids: number[]) => setExporting({ ids, open: true });
  const bar: SelectionActionBarProps = {
    label: `${table.selected.size} selected`,
    onClear: table.clearSelection,
    forTable: TABLE_ID,
    testId: "selection-bar",
    children: (
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => exportTraces([...table.selected].toSorted((a, b) => a - b))}
      >
        Export selected
      </Button>
    ),
  };
  const barShown =
    table.selected.size > 0 && (table.section === "ready" || table.section === "no-results");

  return (
    <ProductScope product="llm-ops">
      <PageLayout.Header
        description={`Support assistant, ${PERIOD}`}
        actions={
          <PageLayout.HeaderButton
            onClick={table.reload}
            loading={table.refreshing === "refreshing"}
          >
            Refresh
          </PageLayout.HeaderButton>
        }
      >
        <PageLayout.Heading>Monitoring</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill">
        <Stack gap={6} minWidth={0}>
          <Trend metrics={start.metrics} metric={metric} onMetric={setMetric} />
          <TraceSection
            table={table}
            tableBox={tableBox}
            bar={barShown && selectionPlacement === "inline" ? bar : undefined}
            onShow={show}
            onExport={(trace) => exportTraces([trace.id])}
          />
        </Stack>
      </PageLayout.Container>

      {barShown && selectionPlacement === "floating" && (
        <SelectionActionBar {...bar} placement="floating" />
      )}
      <TraceDrawer
        trace={SEED_TRACES.find((trace) => trace.id === detail.id)}
        open={detail.open}
        onClose={() => setDetail((current) => ({ ...current, open: false }))}
        onExport={(trace) => {
          setDetail((current) => ({ ...current, open: false }));
          exportTraces([trace.id]);
        }}
        onExitComplete={() => {
          const row = tableBox.current?.querySelector(`[data-trace-id="${opener.current}"]`);
          row?.querySelector<HTMLElement>("td button")?.focus();
        }}
      />
      <ExportDialog
        traces={SEED_TRACES.filter((trace) => exporting.ids.includes(trace.id))}
        open={exporting.open}
        onClose={() => setExporting((current) => ({ ...current, open: false }))}
        onDownload={(traces) => {
          onExport?.({ traces });
          toaster.create({
            type: "success",
            title: `Exported ${countOf({ count: traces.length })}`,
            description: "traces-2026-10-11.csv",
          });
          setExporting((current) => ({ ...current, open: false }));
        }}
      />
      <Toaster />
    </ProductScope>
  );
}

function StatusBadge({ status }: { status: TraceStatus }) {
  return (
    <Badge variant="subtle" colorPalette={STATUS[status].palette}>
      {STATUS[status].label}
    </Badge>
  );
}

function RetryNotice({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: string;
  onRetry: () => void;
}) {
  return (
    <Banner
      status="error"
      placement="inline"
      title={title}
      action={
        <>
          <BannerAction onClick={onRetry}>Try again</BannerAction>
          <EmptyNextSteps next={NO_NEXT} />
        </>
      }
    >
      {children}
    </Banner>
  );
}

function TraceToolbar({
  table,
  bar,
}: {
  table: TraceTableState;
  bar: SelectionActionBarProps | undefined;
}) {
  const countOfStatus = (status: TraceStatus) =>
    table.searched.filter((trace) => trace.status === status).length;
  return (
    <TableToolbar
      disabled={table.section === "loading"}
      search={{
        value: table.query,
        onChange: table.changeQuery,
        placeholder: "Search traces",
        ariaLabel: "Search traces",
      }}
      filters={
        <FilterChips
          groupLabel="Filter traces by status"
          countNoun={{ singular: "trace", plural: "traces" }}
          value={table.status}
          onChange={table.changeStatus}
          items={[
            { value: "all", label: "All", count: table.searched.length },
            { value: "error", label: STATUS.error.label, count: countOfStatus("error") },
            { value: "slow", label: STATUS.slow.label, count: countOfStatus("slow") },
            { value: "ok", label: STATUS.ok.label, count: countOfStatus("ok") },
          ]}
        />
      }
      summary={
        table.section === "loading"
          ? undefined
          : `${table.rows.length} of ${table.traces.length} traces`
      }
      onClearFilters={table.filtered ? table.clearFilters : undefined}
      columns={{
        columns: COLUMNS.map((column) => ({ ...column, visible: table.shown(column.value) })),
        onVisibleChange: table.showColumn,
        onReset: table.resetColumns,
      }}
      selection={bar}
    />
  );
}

/** The heading, toolbar, notices, table and pager of the review table, for any section state. */
function TraceSection({
  table,
  tableBox,
  bar,
  onShow,
  onExport,
}: {
  table: TraceTableState;
  tableBox: RefObject<HTMLDivElement | null>;
  bar: SelectionActionBarProps | undefined;
  onShow: (trace: Trace) => void;
  onExport: (trace: Trace) => void;
}) {
  const { section } = table;
  const hasToolbar = section !== "error" && section !== "empty";
  return (
    <Stack gap={4} minWidth={0} aria-busy={table.busy} data-state={section}>
      <Box>
        <Heading as="h2" textStyle="cardTitle">
          Traces to review
        </Heading>
        <Text textStyle="sm" color="fg.muted">
          The latest {SEED_TRACES.length} traces. The figures and the chart above cover the whole
          week.
        </Text>
      </Box>
      {hasToolbar && <TraceToolbar table={table} bar={bar} />}
      {table.refreshing === "refreshing" && (
        <Text as="output" textStyle="xs" color="fg.muted">
          Refreshing…
        </Text>
      )}
      {table.refreshing === "failed" && (
        <RetryNotice title="Couldn't refresh the traces" onRetry={table.reload}>
          The table still shows the traces from the last refresh.
        </RetryNotice>
      )}
      {section === "error" ? (
        <RetryNotice title="Couldn't load the traces" onRetry={table.reload}>
          The trace service did not answer.
        </RetryNotice>
      ) : (
        <Box ref={tableBox} minWidth={0}>
          <TraceTable table={table} onShow={onShow} onExport={onExport} />
        </Box>
      )}
      {section === "ready" && (
        <Pagination
          page={table.page}
          pageSize={PAGE_SIZE}
          totalCount={table.rows.length}
          unitLabel="traces"
          visibleCount={table.pageRows.length}
          onPageChange={table.setPage}
        />
      )}
    </Stack>
  );
}

function TraceTable({
  table,
  onShow,
  onExport,
}: {
  table: TraceTableState;
  onShow: (trace: Trace) => void;
  onExport: (trace: Trace) => void;
}) {
  const { shown, sort, section } = table;
  const columnCount = 3 + COLUMNS.filter((column) => shown(column.value)).length;
  const sorted = (key: SortKey) => sort.key === key && sort.direction;
  return (
    <ListTable
      id={TABLE_ID}
      aria-label="Traces to review"
      scroll="x"
      scrollLabel="Traces to review"
      minWidth="52rem"
      loading={table.busy}
    >
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.SelectHeader
            label="Select all traces on this page"
            checked={pageTick({ rows: table.pageRows, selected: table.selected })}
            disabled={table.pageRows.length === 0}
            onCheckedChange={({ checked }) =>
              table.tick({ ids: table.pageRows.map((trace) => trace.id), on: checked })
            }
          />
          <ListTable.ColumnHeader>Trace</ListTable.ColumnHeader>
          {shown("status") && <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>}
          {shown("time") && (
            <ListTable.SortHeader sorted={sorted("time")} onSort={() => table.toggleSort("time")}>
              Time
            </ListTable.SortHeader>
          )}
          {shown("duration") && (
            <ListTable.ColumnHeader align="end">Duration</ListTable.ColumnHeader>
          )}
          {shown("cost") && (
            <ListTable.SortHeader
              align="end"
              sorted={sorted("cost")}
              onSort={() => table.toggleSort("cost")}
            >
              Cost (USD)
            </ListTable.SortHeader>
          )}
          {shown("model") && <ListTable.ColumnHeader>Model</ListTable.ColumnHeader>}
          <ListTable.ActionHeader label="Trace actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {section === "loading" && <ListTable.LoadingRows rows={6} columns={columnCount} />}
        {section === "empty" && <EmptyTraces columns={columnCount} />}
        {section === "no-results" && <NoMatchingTraces table={table} columns={columnCount} />}
        {section === "ready" &&
          table.pageRows.map((trace) => (
            <TraceRow
              key={trace.id}
              trace={trace}
              shown={shown}
              selected={table.selected.has(trace.id)}
              onTick={(on) => table.tick({ ids: [trace.id], on })}
              onShow={() => onShow(trace)}
              onExport={() => onExport(trace)}
            />
          ))}
      </ListTable.Body>
    </ListTable>
  );
}

function EmptyTraces({ columns }: { columns: number }) {
  return (
    <ListTable.EmptyRow
      columns={columns}
      state="empty"
      size="block"
      title="No traces yet"
      description="Traces appear here as soon as your assistant handles its first conversation."
      next={[
        { kind: "docs", label: "Read about tracing", href: DOCS },
        { kind: "agent-prompt", prompt: agentPrompt() },
      ]}
    />
  );
}

function NoMatchingTraces({ table, columns }: { table: TraceTableState; columns: number }) {
  const subject = table.query.trim() || STATUS_NAMES[table.status];
  return (
    <ListTable.EmptyRow
      columns={columns}
      state="no-results"
      title="No traces match"
      description={noMatchSentence({ query: table.query, status: table.status })}
      onClearFilters={table.clearFilters}
      next={[
        {
          kind: "agent-prompt",
          label: "Copy a prompt for your coding agent",
          prompt: `Find the LangWatch traces for my support assistant that match "${subject}".`,
        },
      ]}
    />
  );
}

function TraceRow({
  trace,
  shown,
  selected,
  onTick,
  onShow,
  onExport,
}: {
  trace: Trace;
  shown: (column: ColumnKey) => boolean;
  selected: boolean;
  onTick: (on: boolean) => void;
  onShow: () => void;
  onExport: () => void;
}) {
  return (
    <ListTable.Row selected={selected} data-trace-id={trace.id} onActivate={onShow}>
      <ListTable.SelectCell
        label={`Select ${trace.name}`}
        checked={selected}
        onCheckedChange={({ checked }) => onTick(checked)}
      />
      <ListTable.Cell>
        <ListTable.RowAction onActivate={onShow}>{trace.name}</ListTable.RowAction>
        <Text textStyle="xs" color="fg.muted">
          {traceCode(trace)}
        </Text>
      </ListTable.Cell>
      {shown("status") && (
        <ListTable.Cell>
          <StatusBadge status={trace.status} />
        </ListTable.Cell>
      )}
      {shown("time") && (
        <ListTable.Cell tone="muted" nowrap>
          {formatAt(trace)}
        </ListTable.Cell>
      )}
      {shown("duration") && (
        <ListTable.Cell numeric>{formatSeconds({ value: trace.durationMs })}</ListTable.Cell>
      )}
      {shown("cost") && (
        <ListTable.Cell numeric>
          <Money amount={trace.costUsd} currency="USD" locale="en-US" plain />
        </ListTable.Cell>
      )}
      {shown("model") && (
        <ListTable.Cell>
          <InlineCode variant="neutral">{trace.model}</InlineCode>
        </ListTable.Cell>
      )}
      <ListTable.ActionCell>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="xs" variant="ghost" aria-label={`Actions for ${trace.name}`}>
              <span aria-hidden>⋮</span>
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="view" onClick={onShow}>
              View details
            </Menu.Item>
            <Menu.Item value="export" onClick={onExport}>
              Export this trace
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

function TraceDrawer({
  trace,
  open,
  onClose,
  onExport,
  onExitComplete,
}: {
  trace: Trace | undefined;
  open: boolean;
  onClose: () => void;
  onExport: (trace: Trace) => void;
  onExitComplete: () => void;
}) {
  if (!trace) return null;
  return (
    <Drawer
      open={open}
      title={trace.name}
      subtitle={traceCode(trace)}
      badges={<StatusBadge status={trace.status} />}
      size="md"
      onClose={onClose}
      onExitComplete={onExitComplete}
      footer={{
        cancel: { label: "Close", onClick: onClose },
        primaryAction: { label: "Export trace", onClick: () => onExport(trace) },
      }}
    >
      <SummaryList>
        <SummaryListItem label="Status">{STATUS[trace.status].label}</SummaryListItem>
        <SummaryListItem label="Time">{formatAt(trace)} UTC</SummaryListItem>
        <SummaryListItem label="Duration">
          {formatSeconds({ value: trace.durationMs })}
        </SummaryListItem>
        <SummaryListItem label="Cost">
          <Money amount={trace.costUsd} currency="USD" locale="en-US" />
        </SummaryListItem>
        <SummaryListItem label="Model">
          <InlineCode>{trace.model}</InlineCode>
        </SummaryListItem>
      </SummaryList>
    </Drawer>
  );
}

function ExportDialog({
  traces,
  open,
  onClose,
  onDownload,
}: {
  traces: Trace[];
  open: boolean;
  onClose: () => void;
  onDownload: (traces: Trace[]) => void;
}) {
  return (
    <Dialog
      open={open}
      title={`Export ${countOf({ count: traces.length })}`}
      description="A preview of the file. Nothing is saved until you download it."
      size="lg"
      onClose={onClose}
      primaryAction={{ label: "Download CSV", onClick: () => onDownload(traces) }}
    >
      <Stack gap={3}>
        <Text textStyle="sm">
          File <InlineCode>traces-2026-10-11.csv</InlineCode> with columns{" "}
          <InlineCode>{CSV_HEAD}</InlineCode>
        </Text>
        <ListTable aria-label="Traces in the export" scroll="x" scrollLabel="Traces in the export">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Trace</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Cost (USD)</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {traces.map((trace) => (
              <ListTable.Row key={trace.id}>
                <ListTable.Cell>{trace.name}</ListTable.Cell>
                <ListTable.Cell>{STATUS[trace.status].label}</ListTable.Cell>
                <ListTable.Cell numeric>
                  <Money amount={trace.costUsd} currency="USD" locale="en-US" plain />
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      </Stack>
    </Dialog>
  );
}

/** The four figures and the chart. Both read `DAILY`, so the chart always agrees with the tiles. */
function Trend({
  metrics,
  metric,
  onMetric,
}: {
  metrics: "loading" | "empty" | undefined;
  metric: MetricKey;
  onMetric: (metric: MetricKey) => void;
}) {
  if (metrics === "loading") {
    return (
      <Stack gap={4}>
        <StatTileSkeleton columns={4} />
        <Card padding="lg">
          <Skeleton height="260px" aria-label="Loading the chart" aria-busy="true" />
        </Card>
      </Stack>
    );
  }
  const none = metrics === "empty";
  return (
    <Stack gap={4}>
      <Figures none={none} />
      <Card padding="lg">
        <MetricTabs
          label="Metrics"
          value={metric}
          onValueChange={({ value }) => onMetric(value)}
          items={[
            {
              value: "requests",
              label: "Requests",
              figure: none ? "—" : formatCount({ value: TOTAL_REQUESTS }),
              content: <MetricChart metric="requests" none={none} />,
            },
            {
              value: "cost",
              label: "Cost (USD)",
              figure: none ? "—" : formatDollars({ value: TOTAL_COST }),
              content: <MetricChart metric="cost" none={none} />,
            },
            {
              value: "latency",
              label: "Latency (p95)",
              figure: none ? "—" : formatSeconds({ value: AVERAGE_P95 }),
              content: <MetricChart metric="latency" none={none} />,
            },
          ]}
        />
      </Card>
    </Stack>
  );
}

function Figures({ none }: { none: boolean }) {
  const dash = <>—</>;
  const errorRate = ((TOTAL_ERRORS / TOTAL_REQUESTS) * 100).toFixed(1);
  return (
    <StatTileGrid columns={4}>
      <StatTile variant="showcase" label="Requests this week" hint="Calls to the assistant">
        <StatTileFigure muted={none}>
          {none ? dash : formatCount({ value: TOTAL_REQUESTS })}
        </StatTileFigure>
      </StatTile>
      <StatTile variant="showcase" label="Total cost (USD)" hint="All models">
        <StatTileFigure muted={none}>
          {none ? dash : <Money amount={TOTAL_COST} currency="USD" locale="en-US" />}
        </StatTileFigure>
      </StatTile>
      <StatTile variant="showcase" label="Average cost per request (USD)">
        <StatTileFigure muted={none}>
          {none ? (
            dash
          ) : (
            <Money amount={TOTAL_COST / TOTAL_REQUESTS} currency="USD" locale="en-US" />
          )}
        </StatTileFigure>
      </StatTile>
      <StatTile
        variant="showcase"
        label="Errors this week"
        hint={none ? undefined : `${errorRate}% of requests`}
      >
        <Box color={none ? undefined : "fg.error"}>
          <StatTileFigure muted={none}>
            {none ? dash : formatCount({ value: TOTAL_ERRORS })}
          </StatTileFigure>
        </Box>
      </StatTile>
    </StatTileGrid>
  );
}

const CHARTS: Record<
  MetricKey,
  {
    label: string;
    name: string;
    read: (day: Day) => number;
    formatValue: (args: { value: number }) => string;
    formatTick: (args: { value: number }) => string;
    note?: string;
  }
> = {
  requests: {
    label: "Requests per day",
    name: "Requests",
    read: (day: Day) => day.requests,
    formatValue: formatRequests,
    formatTick: formatCount,
  },
  cost: {
    label: "Cost per day (USD)",
    name: "Cost",
    read: (day: Day) => day.costUsd,
    formatValue: formatDollars,
    formatTick: formatDollarTick,
  },
  latency: {
    label: "Latency per day, 95th percentile",
    name: "p95",
    read: (day: Day) => day.p95Ms,
    formatValue: formatSeconds,
    formatTick: formatSecondTick,
    note: "The headline is the average of the daily p95 values; the chart shows each day's p95.",
  },
};

function MetricChart({ metric, none }: { metric: MetricKey; none: boolean }) {
  const { label, name, read, formatValue, formatTick, note } = CHARTS[metric];
  const days = none ? [] : DAILY;
  return (
    <Stack gap={3}>
      <TimeSeriesChart
        label={label}
        series={[{ name, points: days.map((day) => ({ label: day.label, value: read(day) })) }]}
        formatValue={formatValue}
        formatTick={formatTick}
        emptyDescription="Metrics start a minute after the first trace arrives."
      />
      {note && !none && (
        <Text textStyle="xs" color="fg.muted">
          {note}
        </Text>
      )}
      {none && <EmptyNextSteps next={NO_NEXT} />}
    </Stack>
  );
}

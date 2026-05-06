import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  HStack,
  NativeSelect,
  Spacer,
  Spinner,
  Status,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RefreshCw, X } from "lucide-react";
import type {
  DashboardData,
  PendingJobFilter,
  PendingJobSort,
  QueueOverview,
  SearchableJobState,
} from "~/server/app-layer/ops/types";
import type { ConnectionStatus } from "~/hooks/useOpsSSE";
import {
  formatMs,
  formatRate,
  formatTimeAgo,
} from "~/components/ops/shared/formatters";
import { SearchInput } from "~/components/ui/SearchInput";
import { VirtualizedTableRows } from "~/components/ops/shared/VirtualizedTableRows";
import { ThroughputChart } from "~/components/ops/dashboard/ThroughputChart";
import { api } from "~/utils/api";
import { GroupDetailDialog } from "./GroupDetailDialog";
import { PendingJobDetailDialog } from "./PendingJobDetailDialog";
import { STATE_COLOR, STATE_LABEL, displayLabel } from "./pendingJobState";

const TABLE_VIEWPORT_HEIGHT = 460;
const TABLE_ROW_HEIGHT = 36;
const SEARCH_PAGE_SIZE = 100;
const CHART_HEIGHT = 280;

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function PendingTasksCard({
  queueNames,
  data,
  connectionStatus,
}: {
  queueNames: string[];
  data: DashboardData | null;
  connectionStatus: ConnectionStatus;
}) {
  // Persist the selection across re-renders. Default to the first discovered
  // queue, but let the user pick any of the others when more than one
  // exists — previously additional queues were silently dropped.
  const [selectedQueueName, setSelectedQueueName] = useState<string | undefined>(
    queueNames[0],
  );
  useEffect(() => {
    if (selectedQueueName && queueNames.includes(selectedQueueName)) return;
    setSelectedQueueName(queueNames[0]);
  }, [queueNames, selectedQueueName]);
  const queueName = selectedQueueName ?? queueNames[0];
  const utils = api.useUtils();

  const overviewQuery = api.ops.getQueueOverview.useQuery(
    { queueName: queueName ?? "" },
    {
      enabled: !!queueName,
      refetchInterval: false,
      refetchOnWindowFocus: false,
    },
  );

  // Force-refresh runs through the raw trpc client so `force` stays out of
  // the React Query cache key — otherwise toggling state-driven force would
  // fire two fetches per click (force=true then force=undefined).
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);

  const overview = overviewQuery.data ?? null;
  const isOverviewLoading = !!queueName && overviewQuery.isLoading;

  // Filter, sort, and page are lifted here so the state badges can act as
  // toggles for the search section below, and so the refresh handler can
  // force-fetch the canonical search query with the right params.
  const [filter, setFilter] = useState<PendingJobFilter>({});
  const [sort, setSort] = useState<PendingJobSort>("oldest");
  const [page, setPage] = useState(1);

  const toggleStateFilter = (state: SearchableJobState) => {
    setFilter((f) => {
      const next: PendingJobFilter = { ...f };
      if (next.state === state) delete next.state;
      else next.state = state;
      return next;
    });
  };

  const onRefresh = async () => {
    if (!queueName) return;
    setIsForceRefreshing(true);
    try {
      // Send force=true under separate cache keys so the canonical keys the
      // queries watch don't change. Mirror the results back so the watching
      // queries update without triggering another fetch. Both the overview
      // and the search are server-side cached, so both need the bypass.
      const searchParams = {
        queueName,
        filter,
        sort,
        page,
        pageSize: SEARCH_PAGE_SIZE,
      };
      const [freshOverview, freshSearch] = await Promise.all([
        utils.ops.getQueueOverview.fetch({ queueName, force: true }),
        utils.ops.searchPendingJobs.fetch({ ...searchParams, force: true }),
      ]);
      utils.ops.getQueueOverview.setData({ queueName }, freshOverview);
      utils.ops.searchPendingJobs.setData(searchParams, freshSearch);
    } finally {
      setIsForceRefreshing(false);
    }
  };

  if (!queueName) {
    return (
      <Card.Root overflow="hidden">
        <Card.Body padding={4}>
          <Text textStyle="xs" color="fg.muted">No queues discovered.</Text>
        </Card.Body>
      </Card.Root>
    );
  }

  return (
    <VStack align="stretch" gap={3}>
      <OverviewCard
        overview={overview}
        data={data}
        connectionStatus={connectionStatus}
        isLoading={isOverviewLoading}
        onRefresh={onRefresh}
        isRefreshing={overviewQuery.isFetching || isForceRefreshing}
        activeStateFilter={filter.state}
        onToggleState={toggleStateFilter}
        queueNames={queueNames}
        selectedQueueName={queueName}
        onSelectQueue={setSelectedQueueName}
      />

      <SearchSection
        queueName={queueName}
        overview={overview}
        filter={filter}
        setFilter={setFilter}
        sort={sort}
        setSort={setSort}
        page={page}
        setPage={setPage}
      />
    </VStack>
  );
}

function OverviewCard({
  overview,
  data,
  connectionStatus,
  isLoading,
  onRefresh,
  isRefreshing,
  activeStateFilter,
  onToggleState,
  queueNames,
  selectedQueueName,
  onSelectQueue,
}: {
  overview: QueueOverview | null;
  data: DashboardData | null;
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  activeStateFilter: SearchableJobState | undefined;
  onToggleState: (state: SearchableJobState) => void;
  queueNames: string[];
  selectedQueueName: string;
  onSelectQueue: (name: string) => void;
}) {
  // Tick once per second so the freshness label degrades from grey → yellow →
  // orange → red as the snapshot ages, without waiting for a refetch.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totals = overview?.totals;
  const computedMs = overview?.computedDurationMs ?? null;
  const ageMs = overview ? now - overview.generatedAtMs : null;
  const freshness = freshnessFor({ ageMs, isRefreshing });

  return (
    <Card.Root overflow="hidden">
      <Card.Body padding={0}>
        <HStack
          paddingX={4}
          paddingY={2.5}
          gap={4}
          flexWrap="wrap"
          borderBottom="1px solid"
          borderBottomColor="border"
        >
          {/* SNAPSHOT cluster — count, badges, and freshness pill that owns them */}
          <HStack gap={2} alignItems="baseline">
            {queueNames.length > 1 ? (
              <NativeSelect.Root size="xs" width="180px">
                <NativeSelect.Field
                  value={selectedQueueName}
                  onChange={(e) => onSelectQueue(e.target.value)}
                >
                  {queueNames.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            ) : null}
            <Text textStyle="lg" fontWeight="semibold" fontFamily="mono">
              {totals ? formatNumber(totals.groups) : "—"}
            </Text>
            <Text textStyle="xs" color="fg.muted">
              groups · {totals ? formatNumber(totals.jobs) : "—"} jobs
            </Text>
            <Button
              size="2xs"
              variant={freshness.variant}
              colorPalette={freshness.color}
              onClick={onRefresh}
              loading={isRefreshing}
              title={
                computedMs !== null && overview
                  ? `Snapshot — scanned ${overview.groupsScanned} groups in ${computedMs}ms`
                  : "Snapshot"
              }
            >
              <RefreshCw size={10} />
              {isLoading && !overview ? "Loading…" : freshness.label}
            </Button>
          </HStack>

          <Spacer />

          {/* LIVE cluster — chart + rate stats stream over SSE; live status owns them */}
          <HStack gap={3} alignItems="center" flexWrap="wrap">
            {data ? <RateStrip data={data} /> : null}
            <LiveStatus status={connectionStatus} />
          </HStack>
        </HStack>

        <HStack
          paddingX={4}
          paddingY={2}
          gap={1.5}
          flexWrap="wrap"
          borderBottom="1px solid"
          borderBottomColor="border"
          bg="bg.subtle"
        >
          <ToggleChip label="Ready"     count={totals?.ready ?? 0}     color="blue"   active={activeStateFilter === "ready"}     onClick={() => onToggleState("ready")} />
          <ToggleChip label="Scheduled" count={totals?.scheduled ?? 0} color="purple" active={activeStateFilter === "scheduled"} onClick={() => onToggleState("scheduled")} />
          <ToggleChip label="Retrying"  count={totals?.retrying ?? 0}  color="orange" active={activeStateFilter === "retrying"}  onClick={() => onToggleState("retrying")} />
          <ToggleChip label="Blocked"   count={totals?.blocked ?? 0}   color="red"    active={activeStateFilter === "blocked"}   onClick={() => onToggleState("blocked")} />
          <ToggleChip label="Stale"     count={totals?.stale ?? 0}     color="yellow" active={activeStateFilter === "stale"}     onClick={() => onToggleState("stale")} unit="grp" />
          <Spacer />
          <ReadOnlyChip label="Active" count={totals?.active ?? 0} color="green" unit="grp" />
          <ReadOnlyChip label="DLQ"    count={totals?.dlq ?? 0}    color="gray"  unit="grp" />
        </HStack>

        <Box padding={3}>
          {data ? (
            <Box height={`${CHART_HEIGHT}px`}>
              <ThroughputChart data={data} />
            </Box>
          ) : (
            <Center height={`${CHART_HEIGHT}px`}>
              <Spinner size="sm" />
            </Center>
          )}
        </Box>
      </Card.Body>
    </Card.Root>
  );
}

const LIVE_COLOR: Record<ConnectionStatus, "green" | "orange" | "red"> = {
  connected: "green",
  connecting: "orange",
  disconnected: "red",
};
const LIVE_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

function LiveStatus({ status }: { status: ConnectionStatus }) {
  return (
    <Status.Root size="sm" colorPalette={LIVE_COLOR[status]}>
      <Status.Indicator />
      <Text textStyle="xs" color="fg.muted">{LIVE_LABEL[status]}</Text>
    </Status.Root>
  );
}

function RateStrip({ data }: { data: DashboardData }) {
  return (
    <HStack gap={3} color="fg.muted" flexWrap="wrap">
      <RateInline label="Staged" value={`${formatRate(data.throughputIngestedPerSec)}/s`} />
      <RateInline label="Done"   value={`${formatRate(data.completedPerSec)}/s`} />
      <RateInline
        label="Failed"
        value={`${formatRate(data.failedPerSec)}/s`}
        color={data.failedPerSec > 0 ? "red.500" : undefined}
      />
      <RateInline label="P50" value={formatMs(data.latencyP50Ms)} />
      <RateInline label="P99" value={formatMs(data.latencyP99Ms)} />
    </HStack>
  );
}

function RateInline({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <HStack gap={1} alignItems="baseline">
      <Text textStyle="2xs" color="fg.subtle">{label}</Text>
      <Text textStyle="xs" fontFamily="mono" color={color}>{value}</Text>
    </HStack>
  );
}

function freshnessFor({
  ageMs,
  isRefreshing,
}: {
  ageMs: number | null;
  isRefreshing: boolean;
}): { label: string; color: string; variant: "subtle" | "outline" | "solid" } {
  if (isRefreshing) return { label: "Refreshing…", color: "gray", variant: "outline" };
  if (ageMs === null) return { label: "Refresh", color: "gray", variant: "outline" };
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 10) return { label: `${seconds}s ago`, color: "gray", variant: "outline" };
  if (seconds < 30) return { label: `${seconds}s ago`, color: "yellow", variant: "subtle" };
  if (seconds < 120) return { label: `${seconds}s ago — refresh`, color: "orange", variant: "subtle" };
  const minutes = Math.floor(seconds / 60);
  return { label: `${minutes}m ago — refresh`, color: "red", variant: "subtle" };
}

function ToggleChip({
  label,
  count,
  color,
  active,
  onClick,
  unit,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  onClick: () => void;
  unit?: string;
}) {
  return (
    <Button
      size="2xs"
      variant={active ? "solid" : "outline"}
      colorPalette={active ? color : "gray"}
      onClick={onClick}
      paddingX={2}
    >
      <Text textStyle="2xs">{label}</Text>
      <Badge size="xs" colorPalette={active ? "whiteAlpha" : color} variant={active ? "solid" : "subtle"}>
        {formatNumber(count)}
      </Badge>
      {unit ? <Text textStyle="2xs" color={active ? "whiteAlpha.800" : "fg.subtle"}>{unit}</Text> : null}
    </Button>
  );
}

function ReadOnlyChip({
  label,
  count,
  color,
  unit,
}: {
  label: string;
  count: number;
  color: string;
  unit?: string;
}) {
  return (
    <HStack gap={1.5} paddingX={2} paddingY={0.5} bg="bg" borderRadius="md" borderWidth="1px" borderColor="border">
      <Text textStyle="2xs" color="fg.muted">{label}</Text>
      <Badge size="xs" colorPalette={color} variant="subtle">
        {formatNumber(count)}
      </Badge>
      {unit ? <Text textStyle="2xs" color="fg.subtle">{unit}</Text> : null}
    </HStack>
  );
}

function SearchSection({
  queueName,
  overview,
  filter,
  setFilter,
  sort,
  setSort,
  page,
  setPage,
}: {
  queueName: string;
  overview: QueueOverview | null;
  filter: PendingJobFilter;
  setFilter: React.Dispatch<React.SetStateAction<PendingJobFilter>>;
  sort: PendingJobSort;
  setSort: React.Dispatch<React.SetStateAction<PendingJobSort>>;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [jobDetail, setJobDetail] = useState<{ groupId: string; jobId: string } | null>(null);
  const [groupDetail, setGroupDetail] = useState<{ groupId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const searchQuery = api.ops.searchPendingJobs.useQuery(
    {
      queueName,
      filter,
      sort,
      page,
      pageSize: SEARCH_PAGE_SIZE,
    },
    { refetchInterval: false, refetchOnWindowFocus: false },
  );

  const result = searchQuery.data;
  const jobs = result?.jobs ?? [];

  // Reset queue-scoped state on filter/sort/queue change. queueName needs to
  // be in the deps because a stale `page`, `jobDetail`, or `groupDetail` from
  // the previous queue can render an empty page or open a dialog that points
  // at the wrong queue.
  useEffect(() => {
    setPage(1);
    setJobDetail(null);
    setGroupDetail(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filter, sort, queueName, setPage]);

  const updateFilter = (patch: Partial<PendingJobFilter>) => {
    setFilter((f) => {
      const next: PendingJobFilter = { ...f, ...patch };
      for (const k of Object.keys(next) as Array<keyof PendingJobFilter>) {
        if (next[k] === undefined || next[k] === "") delete next[k];
      }
      return next;
    });
  };

  const clearFilters = () => setFilter({});
  const hasActiveFilter = Object.keys(filter).length > 0;

  // Filter dropdowns are populated from the overview breakdown so each option
  // can carry its job count — collapses the "Breakdown" card into the search.
  const pipelineOptions = useMemo(
    () =>
      overview?.byPipeline.map((p) => ({
        value: p.name,
        label: `${displayLabel(p.name)} (${formatNumber(p.jobs)})`,
      })) ?? [],
    [overview?.byPipeline],
  );
  const jobTypeOptions = useMemo(
    () =>
      overview?.byJobType.map((t) => ({
        value: t.name,
        label: `${displayLabel(t.name)} (${formatNumber(t.jobs)})`,
      })) ?? [],
    [overview?.byJobType],
  );
  const tenantOptions = useMemo(
    () =>
      overview?.byTenant.map((t) => ({
        value: t.tenantId,
        label: `${displayLabel(t.tenantId)} (${formatNumber(t.jobs)})`,
      })) ?? [],
    [overview?.byTenant],
  );

  return (
    <Card.Root overflow="hidden">
      <Card.Body padding={0}>
        <VStack align="stretch" gap={0} minWidth={0}>
          <HStack paddingX={4} paddingY={2} borderBottom="1px solid" borderBottomColor="border" gap={2} flexWrap="wrap">
            <Box width="220px">
              <SearchInput
                size="xs"
                placeholder="Group ID contains..."
                value={filter.groupIdContains ?? ""}
                onChange={(e) => updateFilter({ groupIdContains: e.target.value })}
              />
            </Box>

            <FilterSelect
              label="Pipeline"
              value={filter.pipelineName ?? ""}
              options={pipelineOptions}
              onChange={(v) => updateFilter({ pipelineName: v || undefined })}
            />
            <FilterSelect
              label="Type"
              value={filter.jobType ?? ""}
              options={jobTypeOptions}
              onChange={(v) => updateFilter({ jobType: v || undefined })}
            />
            <FilterSelect
              label="Tenant"
              value={filter.tenantId ?? ""}
              options={tenantOptions}
              onChange={(v) => updateFilter({ tenantId: v || undefined })}
            />

            <Spacer />

            <HStack gap={1}>
              <Text textStyle="2xs" color="fg.muted">Sort:</Text>
              <NativeSelect.Root size="xs" width="130px">
                <NativeSelect.Field
                  value={sort}
                  onChange={(e) => setSort(e.target.value as PendingJobSort)}
                >
                  <option value="oldest">Oldest first</option>
                  <option value="youngest">Newest first</option>
                  <option value="mostOverdue">Most overdue</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>

            {hasActiveFilter ? (
              <Button size="2xs" variant="ghost" onClick={clearFilters}>
                <X size={11} /> Clear
              </Button>
            ) : null}
          </HStack>

          <HStack paddingX={4} paddingY={1.5} borderBottom="1px solid" borderBottomColor="border" gap={3}>
            <Text textStyle="2xs" color="fg.muted">
              {searchQuery.isLoading
                ? "Scanning..."
                : result
                  ? `${formatNumber(result.totalMatching)} matches · scanned ${formatNumber(result.scannedGroups)} groups in ${result.computedDurationMs}ms`
                  : "—"}
            </Text>
            {result?.truncated ? (
              <Badge size="xs" colorPalette="orange" variant="subtle">Truncated</Badge>
            ) : null}
            <Spacer />
            <Pager
              page={page}
              pageSize={SEARCH_PAGE_SIZE}
              total={result?.totalMatching ?? 0}
              onPageChange={setPage}
            />
          </HStack>

          {searchQuery.isLoading ? (
            <Center paddingY={6}><Spinner size="sm" /></Center>
          ) : jobs.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">
                {hasActiveFilter ? "No jobs match the current filter." : "No pending jobs."}
              </Text>
            </Box>
          ) : (
            <Box ref={scrollRef} maxHeight={`${TABLE_VIEWPORT_HEIGHT}px`} overflow="auto">
              <Table.Root size="sm" variant="line" tableLayout="fixed" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
                <Table.Header position="sticky" top={0} zIndex={1} bg="bg">
                  <Table.Row>
                    <Table.ColumnHeader width="34%">Group / Job</Table.ColumnHeader>
                    <Table.ColumnHeader width="15%">Pipeline</Table.ColumnHeader>
                    <Table.ColumnHeader width="11%">Type</Table.ColumnHeader>
                    <Table.ColumnHeader width="14%">Tenant</Table.ColumnHeader>
                    <Table.ColumnHeader width="9%">Age</Table.ColumnHeader>
                    <Table.ColumnHeader width="7%" textAlign="end">Retry</Table.ColumnHeader>
                    <Table.ColumnHeader width="10%">State</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <VirtualizedTableRows
                    count={jobs.length}
                    rowHeight={TABLE_ROW_HEIGHT}
                    columnCount={7}
                    scrollContainerRef={scrollRef}
                    getItemKey={(i) => `${jobs[i]!.groupId}/${jobs[i]!.jobId}`}
                    renderRow={(i) => {
                      const job = jobs[i]!;
                      const openDetail = () => {
                        // Stale rows have no real job behind them, so
                        // open the group dialog instead of the job
                        // dialog (which would just say "not found").
                        if (job.state === "stale") {
                          setGroupDetail({ groupId: job.groupId });
                        } else {
                          setJobDetail({ groupId: job.groupId, jobId: job.jobId });
                        }
                      };
                      return (
                        <Table.Row
                          key={`${job.groupId}/${job.jobId}`}
                          cursor="pointer"
                          _hover={{ bg: "bg.subtle" }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Open ${job.state} job ${job.jobId} in group ${job.groupId}`}
                          onClick={openDetail}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openDetail();
                            }
                          }}
                        >
                          <Table.Cell overflow="hidden">
                            <VStack align="start" gap={0} minWidth={0}>
                              <Text textStyle="xs" fontFamily="mono" truncate maxWidth="100%" title={job.groupId}>
                                {job.groupId}
                              </Text>
                              <Text textStyle="2xs" fontFamily="mono" color="fg.subtle" truncate maxWidth="100%" title={job.jobId}>
                                {job.jobId}
                              </Text>
                            </VStack>
                          </Table.Cell>
                          <Table.Cell overflow="hidden">
                            <Text textStyle="xs" color="fg.muted" truncate>
                              {displayLabel(job.pipelineName)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell overflow="hidden">
                            <Text textStyle="xs" color="fg.muted" truncate>
                              {displayLabel(job.jobType)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell overflow="hidden">
                            <Text textStyle="xs" color="fg.muted" truncate>
                              {displayLabel(job.tenantId)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell overflow="hidden">
                            <Text textStyle="xs" truncate>{formatTimeAgo(job.score)}</Text>
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            {(job.retryCount ?? 0) > 0 ? (
                              <Text textStyle="xs" fontFamily="mono" color="orange.500">
                                {job.retryCount}
                              </Text>
                            ) : (
                              <Text textStyle="xs" fontFamily="mono" color="fg.muted">—</Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <Badge size="xs" colorPalette={STATE_COLOR[job.state]} variant="subtle">
                              {STATE_LABEL[job.state]}
                            </Badge>
                          </Table.Cell>
                        </Table.Row>
                      );
                    }}
                  />
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </VStack>
      </Card.Body>

      <PendingJobDetailDialog
        target={jobDetail}
        queueName={queueName}
        onClose={() => setJobDetail(null)}
        onOpenGroup={(groupId) => {
          setJobDetail(null);
          setGroupDetail({ groupId });
        }}
      />
      <GroupDetailDialog
        group={groupDetail ? { queueName, groupId: groupDetail.groupId } : null}
        onClose={() => setGroupDetail(null)}
      />
    </Card.Root>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <HStack gap={1}>
      <Text textStyle="2xs" color="fg.muted">{label}:</Text>
      <NativeSelect.Root size="xs" width="180px">
        <NativeSelect.Field
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">All</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </HStack>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <HStack gap={1}>
      <Button size="2xs" variant="outline" disabled={!canPrev} onClick={() => onPageChange(page - 1)}>
        Prev
      </Button>
      <Text textStyle="2xs" color="fg.muted" minWidth="64px" textAlign="center">
        Page {page} / {totalPages}
      </Text>
      <Button size="2xs" variant="outline" disabled={!canNext} onClick={() => onPageChange(page + 1)}>
        Next
      </Button>
    </HStack>
  );
}

import { PeerComparisonCell, peerComparisonSentence } from "./peer-comparison-cell";
import { percentileStats } from "./percentile";
import { PullRequestStatusBadge } from "./pull-request-status-badge";
import { SortableColumnHeader } from "./sortable-column-header";
import { derivePullRequestStatus, type PullRequestStatus } from "./pull-request-status";
import { usePullRequestSort } from "./pull-request-sort";
import { Button, HStack, Skeleton, Table, Text, VStack } from "@chakra-ui/react";
import { GitPullRequest, MoreVertical } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { LuLink } from "react-icons/lu";

import { GitHubIcon } from "@langwatch/design-system/icons";
import { Menu } from "@langwatch/design-system/menu";
import { ListTable } from "@langwatch/design-system/list-table";
import { Pagination } from "@langwatch/design-system/pagination";
import { SearchInput } from "@langwatch/design-system/search-input";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";

import { Link } from "./activity-link";
import { codingAgentApi as api, type CodingAgentApiMap } from "./coding-agent-api";
import { useCodingAgentActivityHost } from "./coding-agent-activity-host";
import { useCodingAgentRouter } from "./coding-agent-router";
import { CostBreakdownTooltipContent } from "./cost-breakdown-tooltip";
import { formatLastUpdate } from "./last-update";
import { NoDataInfoBlock } from "./no-data-info-block";
import { computeRelativeWindow, PeriodSelector } from "./period-selector";
import { PullRequestDetailDrawer } from "./pull-request-detail-drawer";
import {
  decodePullRequestRef,
  encodePullRequestRef,
  PULL_REQUEST_QUERY_KEY,
} from "./pull-request-detail-address";
import type { Period, PeriodMode } from "./session-filters";
import type { PullRequestSortColumn, PullRequestSortState } from "./pull-request-sort";

/**
 * What each pull request cost in assistant usage.
 *
 * Every row covers the pull request's whole lifetime: the sessions that ran on
 * its branch before it was opened count toward it too. Which pull requests
 * appear is a personal question (the ones this project's own work touched);
 * what each one cost is answered across every project the viewer may read.
 * Branches whose pull request has not been opened yet take their place among
 * the pull requests rather than being listed after them, and stay the viewer's
 * own work.
 *
 * The list opens on the most recently active work and on all time, because the
 * page prices whole lifetimes and a window would hide the long-lived ones. The
 * search box and the period narrow it from there, every column sorts, and a
 * third click on a column hands the order back.
 *
 * Every numeric column reads the same way: the value, and a thin bar under it
 * saying how the row compares to the other rows on this page. Whether the
 * token cost was really spent or covered by a bundled plan is a detail of the
 * money rather than a different kind of number, so it lives in the value's
 * tooltip and never in its color.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/**
 * Most pull requests one status read may ask about, matching the read's own
 * cap. Asking beyond it is refused, so the table reads status for the rows it
 * is showing and leaves the rest unlabelled rather than failing the page.
 */
const MAX_LIVE_STATUS_REFS = 50;

/** How long a status answer is reused before the table asks again. */
const STATUS_STALE_TIME_MS = 60_000;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/**
 * The window the period control shows while no period has been picked. It is
 * a placeholder for the control's own inputs; the trigger reads "All time" and
 * nothing is filtered until the reader chooses a range.
 */
const PLACEHOLDER_PERIOD_PRESET = "30d";

interface LiveStatus {
  status: PullRequestStatus;
  source: "live" | "snapshot";
  mappedAt: Date | null;
}

/** The whole read, as the procedure map defines it. */
type UsagePayload = CodingAgentApiMap["codingAgents"]["pullRequestUsage"]["query"]["output"];

/** One mapped pull request, as the read hands it over. */
type MappedPullRequestPayload = UsagePayload["rows"][number];

/** One branch whose pull request has not been opened (or mapped) yet. */
type UnlinkedBranchPayload = UsagePayload["unlinked"][number];

/** What one model consumed on a pull request. */
type ModelUsage = MappedPullRequestPayload["modelBreakdown"][number];

/** A period the reader picked, and which way they picked it. */
interface PeriodSelection {
  period: Period;
  mode: PeriodMode;
}

/**
 * One line of the table. A pull request row carries its number, title and
 * stored status; a branch row is the same work before a pull request exists
 * for it.
 */
interface PullRequestListRow {
  key: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  pullRequest: {
    number: number;
    title: string;
    htmlUrl: string;
  } | null;
  /** The status the last read of GitHub stored, or null for a branch row. */
  snapshotStatus: PullRequestStatus | null;
  /** When this row's counted work last ran, epoch ms, 0 when unknown. */
  lastActivityAtMs: number;
  totalTokens: number;
  costUsd: number | null;
  nonBilledCostUsd: number | null;
  billedCostUsd: number | null;
  modelBreakdown: ModelUsage[];
  /** Whether the organization's connection reaches this repository. */
  repositoryCovered: boolean;
}

/** The placeholder for a value a row does not have. */
const MISSING_VALUE = "—";

const refKeyOf = (ref: { repositoryHost: string; repositoryFullName: string; prNumber: number }) =>
  `${ref.repositoryHost} ${ref.repositoryFullName} ${ref.prNumber}`;

/**
 * The current status of every pull request on the page, asked for as one read
 * and reused for a minute so a refresh or a second viewer costs nothing.
 */
function useLiveStatuses({ projectId, rows }: { projectId: string; rows: PullRequestListRow[] }) {
  const refs = useMemo(
    () =>
      rows
        .flatMap((row) =>
          row.pullRequest
            ? [
                {
                  repositoryHost: row.repositoryHost,
                  repositoryFullName: row.repositoryFullName,
                  prNumber: row.pullRequest.number,
                },
              ]
            : [],
        )
        .slice(0, MAX_LIVE_STATUS_REFS),
    [rows],
  );

  const query = api.github.pullRequestLiveStatus.useQuery(
    { projectId, refs },
    {
      enabled: refs.length > 0,
      staleTime: STATUS_STALE_TIME_MS,
      refetchOnWindowFocus: false,
    },
  );

  const byRef = useMemo(() => {
    const map = new Map<string, LiveStatus>();
    for (const status of query.data?.statuses ?? []) {
      map.set(refKeyOf(status), {
        status: status.status,
        source: status.source,
        mappedAt: status.mappedAt,
      });
    }
    return map;
  }, [query.data]);

  return { byRef };
}

export function PullRequestsTable({ projectId }: { projectId: string }) {
  const host = useCodingAgentActivityHost();
  const canManageOrganization = host.hasPermission("organization:manage");

  const usageQuery = api.codingAgents.pullRequestUsage.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  );
  const rows = useMemo<PullRequestListRow[]>(() => toListRows(usageQuery.data), [usageQuery.data]);

  if (usageQuery.isLoading) {
    return <Skeleton height="180px" borderRadius="md" />;
  }

  if (usageQuery.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        Couldn&apos;t load pull requests
      </Text>
    );
  }

  const connection = usageQuery.data?.connection;
  if (!connection?.connected) {
    return (
      <NotConnectedState
        installUrl={connection?.installUrl ?? null}
        canManageOrganization={canManageOrganization}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <NoDataInfoBlock
        title="No pull requests yet"
        icon={<GitPullRequest />}
        description="Pull requests show up here once your coding agent runs on a branch that has one."
      />
    );
  }

  return (
    <ListedPullRequests
      projectId={projectId}
      rows={rows}
      installUrl={connection.installUrl}
      canManageOrganization={canManageOrganization}
    />
  );
}

/** The rows themselves, narrowed and ordered, one page at a time. */
const ListedPullRequests: React.FC<{
  projectId: string;
  rows: PullRequestListRow[];
  installUrl: string | null;
  canManageOrganization: boolean;
}> = ({ projectId, rows, installUrl, canManageOrganization }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection | null>(null);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          matchesPullRequestSearch({ row, query: search }) &&
          isWithinPeriod({
            lastActivityAtMs: row.lastActivityAtMs,
            period: periodSelection?.period ?? null,
          }),
      ),
    [rows, search, periodSelection],
  );
  const { sorted, sort, onSort } = usePullRequestSort({ rows: filteredRows });

  // A refetch, a search or a narrower period can leave fewer rows than the page
  // the reader is already on, and the pager clamps only what it prints. Slicing
  // on the stored page would empty the table under a footer reading "Page 1 of
  // 1", so the slice, the pager and the next click all work off the clamped
  // page.
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = useMemo(
    () => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sorted, currentPage, pageSize],
  );

  return (
    <VStack align="stretch" gap={3} width="full">
      <PullRequestsToolbar
        search={search}
        periodSelection={periodSelection}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onPeriodChange={(selection) => {
          setPeriodSelection(selection);
          setPage(1);
        }}
      />
      {sorted.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No pull requests match
        </Text>
      ) : (
        <OnePageOfPullRequests
          projectId={projectId}
          rows={visibleRows}
          totalCount={sorted.length}
          page={currentPage}
          pageSize={pageSize}
          sort={sort}
          installUrl={installUrl}
          canManageOrganization={canManageOrganization}
          onSort={(column) => {
            onSort(column);
            setPage(1);
          }}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </VStack>
  );
};

/**
 * The page the reader is looking at, with the two reads that only make sense
 * for the rows actually on it: what GitHub says about each one right now, and
 * how each number compares to its peers here.
 */
const OnePageOfPullRequests: React.FC<{
  projectId: string;
  rows: PullRequestListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  sort: PullRequestSortState;
  installUrl: string | null;
  canManageOrganization: boolean;
  onSort: (column: PullRequestSortColumn) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}> = ({
  projectId,
  rows,
  totalCount,
  page,
  pageSize,
  sort,
  installUrl,
  canManageOrganization,
  onSort,
  onPageChange,
  onPageSizeChange,
}) => {
  const router = useCodingAgentRouter();
  // The pull request the detail drawer is open on lives in the address, so a
  // shared link reopens it. See `pull-request-detail-address`.
  const openPullRequest = decodePullRequestRef(router.query[PULL_REQUEST_QUERY_KEY]);
  const statuses = useLiveStatuses({ projectId, rows });
  const { tokenStats, costStats } = usePageStats(rows);

  return (
    <>
      <ListTable size="sm">
        <TableHeaderRow sort={sort} onSort={onSort} />
        <Table.Body>
          {rows.map((row) => (
            <PullRequestRow
              key={row.key}
              row={row}
              status={row.pullRequest ? statuses.byRef.get(statusKeyOf(row)) : undefined}
              installUrl={installUrl}
              canManageOrganization={canManageOrganization}
              tokenStats={tokenStats}
              costStats={costStats}
              onOpenDetail={detailOpenerFor({ row, router })}
            />
          ))}
        </Table.Body>
      </ListTable>
      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        unitLabel="pull requests"
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
      {openPullRequest && (
        <PullRequestDetailDrawer
          projectId={projectId}
          repositoryHost={openPullRequest.repositoryHost}
          repositoryFullName={openPullRequest.repositoryFullName}
          prNumber={openPullRequest.prNumber}
          onClose={() =>
            router.setQueryParams({ [PULL_REQUEST_QUERY_KEY]: void 0 }, { replace: true })
          }
        />
      )}
    </>
  );
};

/**
 * The two ways the list narrows: a word, and a stretch of time. Both are the
 * table's own state rather than the address bar's, because the page is one
 * table rather than a whole surface, and a period the reader never asked for
 * would hide the long-lived pull requests this page exists to price.
 */
const PullRequestsToolbar: React.FC<{
  search: string;
  periodSelection: PeriodSelection | null;
  onSearchChange: (value: string) => void;
  onPeriodChange: (selection: PeriodSelection | null) => void;
}> = ({ search, periodSelection, onSearchChange, onPeriodChange }) => (
  <HStack gap={2} width="full" justify="space-between">
    <SearchInput
      value={search}
      placeholder="Search pull requests"
      maxWidth="320px"
      onChange={(event) => onSearchChange(event.target.value)}
    />
    <PeriodSelector
      period={
        periodSelection?.period ?? computeRelativeWindow(PLACEHOLDER_PERIOD_PRESET, new Date())
      }
      mode={periodSelection?.mode ?? "relative"}
      label={periodSelection ? undefined : "All time"}
      setPeriod={(startDate, endDate) =>
        onPeriodChange({ period: { startDate, endDate }, mode: "absolute" })
      }
      setRelativePeriod={(presetKey) =>
        onPeriodChange({
          period: computeRelativeWindow(presetKey, new Date()),
          mode: "relative",
        })
      }
      clearPeriod={() => onPeriodChange(null)}
    />
  </HStack>
);

/**
 * Whether a row survives the search box. A query that is a number, with or
 * without GitHub's leading hash, also matches the pull request number, so
 * "#4218" and "4218" both find it; a query carrying anything else is not a
 * number and never matches one.
 */
function matchesPullRequestSearch({
  row,
  query,
}: {
  row: PullRequestListRow;
  query: string;
}): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  if (
    /^\d+$/.test(digits) &&
    row.pullRequest !== null &&
    String(row.pullRequest.number).includes(digits)
  ) {
    return true;
  }

  return [row.pullRequest?.title ?? "", row.headBranch, row.repositoryFullName].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/** Whether a row's last update falls inside the period, if there is one. */
function isWithinPeriod({
  lastActivityAtMs,
  period,
}: {
  lastActivityAtMs: number;
  period: Period | null;
}): boolean {
  if (period === null) return true;
  return (
    lastActivityAtMs >= period.startDate.getTime() && lastActivityAtMs <= period.endDate.getTime()
  );
}

/**
 * Where each numeric column's values sit, measured against the page the reader
 * is looking at, and each column against its own values: a pull request can be
 * heavy on tokens and cheap in money, or the reverse, so one shared scale
 * would misread both.
 */
function usePageStats(rows: PullRequestListRow[]) {
  const tokenStats = useMemo(() => percentileStats(rows.map((row) => row.totalTokens)), [rows]);
  const costStats = useMemo(() => percentileStats(rows.map((row) => row.costUsd ?? 0)), [rows]);
  return { tokenStats, costStats };
}

/** What clicking a row does. A branch with no pull request opens nothing. */
function detailOpenerFor({
  row,
  router,
}: {
  row: PullRequestListRow;
  router: ReturnType<typeof useCodingAgentRouter>;
}): (() => void) | undefined {
  const pullRequest = row.pullRequest;
  if (!pullRequest) return undefined;
  return () =>
    router.setQueryParams({
      [PULL_REQUEST_QUERY_KEY]: encodePullRequestRef({
        repositoryHost: row.repositoryHost,
        repositoryFullName: row.repositoryFullName,
        prNumber: pullRequest.number,
      }),
    });
}

/** The status map key for a row that has a pull request. */
function statusKeyOf(row: PullRequestListRow): string {
  return refKeyOf({
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    prNumber: row.pullRequest?.number ?? 0,
  });
}

const TableHeaderRow: React.FC<{
  sort: PullRequestSortState;
  onSort: (column: PullRequestSortColumn) => void;
}> = ({ sort, onSort }) => (
  <Table.Header>
    <Table.Row>
      <SortableColumnHeader label="Pull request" column="number" sort={sort} onSort={onSort} />
      <SortableColumnHeader label="Title" column="title" sort={sort} onSort={onSort} />
      <SortableColumnHeader label="Status" column="status" sort={sort} onSort={onSort} />
      <SortableColumnHeader label="Last update" column="lastActivity" sort={sort} onSort={onSort} />
      <SortableColumnHeader label="Models" column="models" sort={sort} onSort={onSort} />
      <SortableColumnHeader
        label="Tokens"
        column="tokens"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortableColumnHeader
        label="Token cost"
        column="cost"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <Table.ColumnHeader width={12} />
    </Table.Row>
  </Table.Header>
);

const NotConnectedState: React.FC<{
  installUrl: string | null;
  canManageOrganization: boolean;
}> = ({ installUrl, canManageOrganization }) => (
  <NoDataInfoBlock
    title="GitHub is not connected"
    icon={<GitPullRequest />}
    description={
      canManageOrganization
        ? "Connect GitHub so your sessions line up with the pull requests they went into."
        : "Ask an administrator to connect GitHub, then your sessions will line up with the pull requests they went into."
    }
  >
    {canManageOrganization && installUrl ? (
      <Button asChild size="sm">
        <a href={installUrl}>Connect GitHub</a>
      </Button>
    ) : null}
  </NoDataInfoBlock>
);

const PullRequestRow: React.FC<{
  row: PullRequestListRow;
  status: LiveStatus | undefined;
  installUrl: string | null;
  canManageOrganization: boolean;
  tokenStats: { p95: number; hasStats: boolean };
  costStats: { p95: number; hasStats: boolean };
  onOpenDetail: (() => void) | undefined;
}> = ({ row, status, installUrl, canManageOrganization, tokenStats, costStats, onOpenDetail }) => (
  <Table.Row
    onClick={onOpenDetail}
    cursor={onOpenDetail ? "pointer" : undefined}
    _hover={onOpenDetail ? { bg: "bg.subtle" } : undefined}
  >
    <Table.Cell>
      {row.pullRequest ? (
        // The row opens the detail; this link leaves for GitHub, so it stops
        // the click from reaching the row underneath it.
        <Link
          href={row.pullRequest.htmlUrl}
          isExternal
          color="fg.muted"
          fontFamily="mono"
          fontSize="sm"
          onClick={(event) => event.stopPropagation()}
        >
          #{row.pullRequest.number}
        </Link>
      ) : (
        <Text fontSize="sm" color="fg.subtle">
          {MISSING_VALUE}
        </Text>
      )}
    </Table.Cell>
    <Table.Cell maxWidth="360px">
      {row.pullRequest ? (
        <Text fontSize="sm" fontWeight="medium" truncate>
          {row.pullRequest.title || row.headBranch}
        </Text>
      ) : (
        <Text fontSize="sm" fontFamily="mono" truncate>
          {row.headBranch}
        </Text>
      )}
      <HStack gap={2} minWidth={0}>
        <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate>
          {row.repositoryFullName}
        </Text>
        {!row.repositoryCovered && installUrl !== null ? (
          <LinkRepositoryButton
            installUrl={installUrl}
            canManageOrganization={canManageOrganization}
          />
        ) : null}
      </HStack>
    </Table.Cell>
    <Table.Cell>
      <StatusCell row={row} status={status} />
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted" whiteSpace="nowrap">
      {row.lastActivityAtMs === 0
        ? MISSING_VALUE
        : formatLastUpdate({ timestampMs: row.lastActivityAtMs })}
    </Table.Cell>
    <Table.Cell maxWidth="160px">
      <ModelsCell models={row.modelBreakdown} />
    </Table.Cell>
    <Table.Cell textAlign="end">
      <PeerComparisonCell
        value={row.totalTokens}
        p95={tokenStats.p95}
        hasStats={tokenStats.hasStats}
        formatValue={formatTokens}
        metricPhrase="total tokens"
      />
    </Table.Cell>
    <Table.Cell textAlign="end">
      <TokenCostCell row={row} stats={costStats} />
    </Table.Cell>
    <Table.Cell>
      <RowActionsMenu
        row={row}
        installUrl={installUrl}
        canManageOrganization={canManageOrganization}
        onOpenDetail={onOpenDetail}
      />
    </Table.Cell>
  </Table.Row>
);

/**
 * The invitation to bring a repository into the connection, offered on the row
 * where the reader notices it is missing rather than on a settings page two
 * navigations away.
 */
const LinkRepositoryButton: React.FC<{
  installUrl: string;
  canManageOrganization: boolean;
}> = ({ installUrl, canManageOrganization }) => {
  if (canManageOrganization) {
    return (
      <Button asChild size="xs" variant="outline" flexShrink={0}>
        <a href={installUrl} onClick={(event) => event.stopPropagation()}>
          <GitHubIcon size={12} />
          Link this repo
        </a>
      </Button>
    );
  }

  return (
    <Tooltip content="Ask an administrator to link this repository.">
      {/* A disabled button fires no pointer events at all, so the hover would
          never reach the tooltip and the reason would go unsaid. The span
          carries the events, and a tab stop so it is reachable without a
          pointer. It also swallows the click: the button under it is inert,
          and a click meant for it must not fall through to the row. */}
      <span tabIndex={0} onClick={(event) => event.stopPropagation()}>
        <Button size="xs" variant="outline" disabled flexShrink={0}>
          <GitHubIcon size={12} />
          Link this repo
        </Button>
      </span>
    </Tooltip>
  );
};

/**
 * The pull request's state, drawn the way GitHub draws it. The stored snapshot
 * answers straight away so the column is never blank while GitHub is asked,
 * and the live answer replaces it the moment it lands.
 */
const StatusCell: React.FC<{
  row: PullRequestListRow;
  status: LiveStatus | undefined;
}> = ({ row, status }) => {
  if (row.snapshotStatus === null) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No PR yet
      </Text>
    );
  }

  if (status) {
    return (
      <PullRequestStatusBadge
        status={status.status}
        source={status.source}
        mappedAt={status.mappedAt}
      />
    );
  }

  return <PullRequestStatusBadge status={row.snapshotStatus} source="payload" />;
};

/**
 * The leading model, and how many others rode along.
 *
 * An entry whose totals are not known carries its name alone. Which models a
 * row ran, and how much can be said about each, is the read's question and it
 * has already answered it; this cell only draws the answer.
 */
const ModelsCell: React.FC<{ models: ModelUsage[] }> = ({ models }) => {
  if (models.length === 0) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }
  const [primary, ...rest] = models;
  return (
    <Tooltip
      content={
        <VStack align="start" gap={0.5}>
          {models.map((model) => (
            <Text key={model.model}>
              {model.model}
              {model.tokensKnown
                ? `: ${formatTokens(model.totalTokens)} tokens${model.costUsd === null ? "" : `, ${formatCost(model.costUsd)}`}`
                : ""}
            </Text>
          ))}
        </VStack>
      }
      positioning={{ placement: "left" }}
    >
      <Text fontSize="xs" color="fg.muted" cursor="help" truncate tabIndex={0}>
        {primary!.model}
        {rest.length > 0 ? ` +${rest.length}` : ""}
      </Text>
    </Tooltip>
  );
};

/**
 * The list-price cost of the row, read exactly like every other number here:
 * one value, one comparison bar. Money a bundled plan already covered is still
 * that same list price, so it is explained on hover rather than set apart by a
 * color the reader would have to learn.
 */
const TokenCostCell: React.FC<{
  row: PullRequestListRow;
  stats: { p95: number; hasStats: boolean };
}> = ({ row, stats }) => {
  if (row.costUsd === null) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  const nonBilled = row.nonBilledCostUsd ?? 0;
  const isBundled = nonBilled > 0;
  const sentence = peerComparisonSentence({
    value: row.costUsd,
    p95: stats.p95,
    hasStats: stats.hasStats,
    formatValue: (value) => formatCost(value),
    metricPhrase: "in token cost",
  });

  return (
    <PeerComparisonCell
      value={row.costUsd}
      p95={stats.p95}
      hasStats={stats.hasStats}
      formatValue={(value) => formatCost(value)}
      metricPhrase="in token cost"
      tooltipContent={
        isBundled ? (
          <VStack align="stretch" gap={2}>
            <CostBreakdownTooltipContent
              isBundled
              billedCost={row.billedCostUsd ?? 0}
              nonBilledCost={nonBilled}
              grandCost={row.costUsd}
            />
            {sentence ? <Text textStyle="2xs">{sentence}</Text> : null}
          </VStack>
        ) : undefined
      }
    />
  );
};

const RowActionsMenu: React.FC<{
  row: PullRequestListRow;
  installUrl: string | null;
  canManageOrganization: boolean;
  onOpenDetail: (() => void) | undefined;
}> = ({ row, installUrl, canManageOrganization, onOpenDetail }) => {
  const githubUrl =
    row.pullRequest?.htmlUrl ??
    `https://${row.repositoryHost}/${row.repositoryFullName}/tree/${row.headBranch}`;
  const canOfferLinking = !row.repositoryCovered && installUrl !== null;

  return (
    // The row itself opens the detail, so every control inside it has to stop
    // the click from reaching the row, or opening a menu would open a drawer
    // behind it.
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for ${
              row.pullRequest ? `pull request ${row.pullRequest.number}` : row.headBranch
            }`}
          >
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {onOpenDetail ? (
            <Menu.Item value="details" onClick={onOpenDetail}>
              View details
            </Menu.Item>
          ) : null}
          <Menu.Item value="open" asChild>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              <GitHubIcon size={14} />
              Open on GitHub
            </a>
          </Menu.Item>
          {canOfferLinking &&
            (canManageOrganization ? (
              <Menu.Item value="link" asChild>
                <a href={installUrl}>
                  <LuLink />
                  Link this repository
                </a>
              </Menu.Item>
            ) : (
              <Tooltip
                content="Ask an administrator to link this repository."
                positioning={{ placement: "left" }}
                showArrow
              >
                <Menu.Item value="link" disabled opacity={0.5} cursor="not-allowed">
                  <LuLink />
                  Link this repository
                </Menu.Item>
              </Tooltip>
            ))}
        </Menu.Content>
      </Menu.Root>
    </div>
  );
};

function toMappedListRow(row: MappedPullRequestPayload): PullRequestListRow {
  return {
    key: `pull-request ${row.repositoryHost} ${row.repositoryFullName} ${row.prNumber}`,
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    headBranch: row.headBranch,
    pullRequest: {
      number: row.prNumber,
      title: row.title,
      htmlUrl: row.htmlUrl,
    },
    snapshotStatus: derivePullRequestStatus({
      state: row.state,
      isDraft: row.isDraft,
      prMergedAtMs: row.prMergedAtMs,
    }),
    lastActivityAtMs: row.lastActivityAtMs,
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
    billedCostUsd: row.billedCostUsd,
    nonBilledCostUsd: row.nonBilledCostUsd,
    modelBreakdown: row.modelBreakdown,
    // A mapped pull request came through the connection, so the repository it
    // lives in is covered by definition.
    repositoryCovered: true,
  };
}

function toBranchListRow(row: UnlinkedBranchPayload): PullRequestListRow {
  return {
    key: `branch ${row.repositoryHost} ${row.repositoryFullName} ${row.headBranch}`,
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    headBranch: row.headBranch,
    pullRequest: null,
    snapshotStatus: null,
    lastActivityAtMs: row.lastActivityAtMs,
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
    billedCostUsd: row.billedCostUsd,
    nonBilledCostUsd: row.nonBilledCostUsd,
    modelBreakdown: row.modelBreakdown,
    repositoryCovered: row.repoCovered,
  };
}

/**
 * Flatten the read into one list. The order is the table's own question, and
 * a branch takes its place among the pull requests rather than after them.
 */
function toListRows(data: UsagePayload | undefined): PullRequestListRow[] {
  if (!data) return [];

  return [...data.rows.map(toMappedListRow), ...data.unlinked.map(toBranchListRow)];
}

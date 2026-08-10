import {
  Box,
  Button,
  HStack,
  Skeleton,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical, SquareTerminal } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import {
  computeRelativeWindow,
  type Period,
  type PeriodMode,
  PeriodSelector,
} from "~/components/PeriodSelector";
import { ListTable } from "~/components/ui/ListTable";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { Pagination } from "~/components/ui/Pagination";
import { SearchInput } from "~/components/ui/SearchInput";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { showErrorToast } from "~/features/errors";
import { useDrawerStore } from "~/features/traces-v2/stores/drawerStore";
import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";
import { useDrawer } from "~/hooks/useDrawer";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

import { AgentLabel } from "./AgentLabel";
import { formatDurationSeconds } from "./duration";
import { formatLastUpdate } from "./lastUpdate";
import { SortableColumnHeader } from "./SortableColumnHeader";
import {
  type SessionsSortColumn,
  type SessionsSortState,
  sessionLastUpdateAtMs,
  sessionTotalTokens,
  useSessionsSort,
} from "./useSessionsSort";

/**
 * Every coding-agent session of the last quarter, and what it cost in context
 * rather than only in tokens.
 *
 * The personal usage card answers "what did I spend this month" in four
 * numbers; this table answers "on what". One row per session, named by the
 * title its agent generated, carrying the economics that decide whether a
 * session was cheap or ruinous (the peak context it carried, how often it
 * compacted, how often it rebuilt its cache, how long it worked against how
 * long it waited on its human) and the pull requests it drove.
 *
 * The list opens on the session that moved most recently and on all time,
 * because a window would hide the long-lived ones. The search box and the
 * period narrow it from there, every column sorts, and a third click on a
 * column hands the order back.
 *
 * Choosing a row replays the session in the terminal view, in place: the
 * drawer opens over the table, so leaving it puts the reader back exactly
 * where they were rather than on a page they have to narrow again.
 *
 * Spec: specs/coding-agent/sessions-screen.feature.
 */

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/** How many pull requests a row names before the rest go behind a hover. */
const MAX_LISTED_PULL_REQUESTS = 3;

/**
 * The window the period control shows while no period has been picked. It is
 * a placeholder for the control's own inputs; the trigger reads "All time" and
 * nothing is filtered until the reader chooses a range.
 */
const PLACEHOLDER_PERIOD_PRESET = "30d";

/** The placeholder for a value a row does not have. */
const MISSING_VALUE = "—";

/** One session as the read hands it over. */
type SessionPayload = RouterOutputs["codingAgents"]["sessionsList"][number];

/** One pull request a session drove. */
type SessionPullRequest = SessionPayload["pullRequests"][number];

/**
 * One line of the table: the read's own row, plus the two figures the table
 * orders and narrows by, worked out once rather than on every comparison.
 */
interface SessionListRow extends SessionPayload {
  /** `owner/name`, or empty when the session reported no remote. */
  repositoryFullName: string;
  /** When the session last moved: its last event, or its start. */
  lastUpdateAtMs: number;
  /** Every token it consumed, live and cached alike. */
  totalTokens: number;
}

/** A period the reader picked, and which way they picked it. */
interface PeriodSelection {
  period: Period;
  mode: PeriodMode;
}

export function SessionsTable({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string | null;
}) {
  const sessionsQuery = api.codingAgents.sessionsList.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  );
  const rows = useMemo<SessionListRow[]>(
    () => (sessionsQuery.data ?? []).map(toListRow),
    [sessionsQuery.data],
  );

  if (sessionsQuery.isLoading) {
    return <Skeleton height="180px" borderRadius="md" />;
  }

  if (sessionsQuery.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        Couldn&apos;t load sessions
      </Text>
    );
  }

  if (rows.length === 0) {
    return (
      <NoDataInfoBlock
        title="No sessions recorded yet"
        icon={<SquareTerminal />}
        description="Sessions show up here once your coding agent reports one."
      />
    );
  }

  return (
    <ListedSessions
      projectId={projectId}
      projectSlug={projectSlug}
      rows={rows}
    />
  );
}

/** The rows themselves, narrowed and ordered, one page at a time. */
const ListedSessions: React.FC<{
  projectId: string;
  projectSlug: string | null;
  rows: SessionListRow[];
}> = ({ projectId, projectSlug, rows }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [periodSelection, setPeriodSelection] =
    useState<PeriodSelection | null>(null);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          matchesSessionSearch({ row, query: search }) &&
          isWithinPeriod({
            lastUpdateAtMs: row.lastUpdateAtMs,
            period: periodSelection?.period ?? null,
          }),
      ),
    [rows, search, periodSelection],
  );
  const { sorted, sort, onSort } = useSessionsSort({ rows: filteredRows });

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
      <SessionsToolbar
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
          No sessions match
        </Text>
      ) : (
        <OnePageOfSessions
          projectId={projectId}
          projectSlug={projectSlug}
          rows={visibleRows}
          totalCount={sorted.length}
          page={currentPage}
          pageSize={pageSize}
          sort={sort}
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
 * The page the reader is looking at. The comparison bars are scaled against
 * this page alone, and each column against its own values: a session can carry
 * a huge context and cost very little, or the reverse, so one shared scale
 * would misread both.
 */
const OnePageOfSessions: React.FC<{
  projectId: string;
  projectSlug: string | null;
  rows: SessionListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  sort: SessionsSortState;
  onSort: (column: SessionsSortColumn) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}> = ({
  projectId,
  projectSlug,
  rows,
  totalCount,
  page,
  pageSize,
  sort,
  onSort,
  onPageChange,
  onPageSizeChange,
}) => {
  const replay = useTerminalReplay({ projectId, projectSlug });
  const largestPeak = rows.reduce(
    (max, row) => Math.max(max, row.peakContextTokens),
    0,
  );
  const largestCost = rows.reduce(
    (max, row) => Math.max(max, row.costUsd ?? 0),
    0,
  );

  return (
    <>
      <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
        <TableHeaderRow sort={sort} onSort={onSort} />
        <Table.Body>
          {rows.map((row) => (
            <SessionRow
              key={row.sessionId}
              row={row}
              largestPeak={largestPeak}
              largestCost={largestCost}
              isOpening={replay.openingSessionId === row.sessionId}
              onOpenReplay={() => void replay.openReplay(row)}
              onOpenInExplorer={
                projectSlug ? () => void replay.openInExplorer(row) : undefined
              }
              onPrefetch={() => replay.prefetch(row)}
            />
          ))}
        </Table.Body>
      </ListTable>
      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        unitLabel="sessions"
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  );
};

/**
 * The two ways the list narrows: a word, and a stretch of time. Both are the
 * table's own state rather than the address bar's, because the page is one
 * table rather than a whole surface, and a period the reader never asked for
 * would hide the sessions that ran before this week.
 */
const SessionsToolbar: React.FC<{
  search: string;
  periodSelection: PeriodSelection | null;
  onSearchChange: (value: string) => void;
  onPeriodChange: (selection: PeriodSelection | null) => void;
}> = ({ search, periodSelection, onSearchChange, onPeriodChange }) => (
  <HStack gap={2} width="full" justify="space-between">
    <SearchInput
      value={search}
      placeholder="Search sessions"
      maxWidth="320px"
      onChange={(event) => onSearchChange(event.target.value)}
    />
    <PeriodSelector
      period={
        periodSelection?.period ??
        computeRelativeWindow(PLACEHOLDER_PERIOD_PRESET, new Date())
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
 * What the reader has to type to keep a row. Everything named on the row is
 * matchable, plus the branches and models that are not: a session is often
 * remembered by the branch it ran on rather than by the title an agent gave
 * it. A query that is a number, with or without GitHub's leading hash, also
 * matches a pull request number.
 */
function matchesSessionSearch({
  row,
  query,
}: {
  row: SessionListRow;
  query: string;
}): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  if (
    /^\d+$/.test(digits) &&
    row.pullRequests.some((pullRequest) =>
      String(pullRequest.number).includes(digits),
    )
  ) {
    return true;
  }

  return [
    row.title ?? "",
    row.repositoryName,
    row.repositoryFullName,
    row.agent,
    ...row.gitBranches,
    ...row.models,
  ].some((field) => field.toLowerCase().includes(needle));
}

/** Whether a row's last update falls inside the period, if there is one. */
function isWithinPeriod({
  lastUpdateAtMs,
  period,
}: {
  lastUpdateAtMs: number;
  period: Period | null;
}): boolean {
  if (period === null) return true;
  return (
    lastUpdateAtMs >= period.startDate.getTime() &&
    lastUpdateAtMs <= period.endDate.getTime()
  );
}

/**
 * Opening a session's terminal replay.
 *
 * A session is a conversation of many turns and the replay reads the last of
 * them, so the trace has to be looked up before anything can open. The lookup
 * is the same one the drawer itself caches, so hovering a row pays for it
 * ahead of the click and the click usually opens on the next frame.
 *
 * The drawer opens over this page rather than navigating to the explorer: the
 * global mount renders it wherever the reader is, so closing it puts them back
 * on the table they narrowed rather than on a fresh one.
 */
function useTerminalReplay({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string | null;
}) {
  const utils = api.useUtils();
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);

  const withLastTurn = useCallback(
    async (row: SessionListRow, open: (turn: ConversationTurn) => void) => {
      setOpeningSessionId(row.sessionId);
      try {
        const turn = await lastTurnOfSession({
          utils,
          projectId,
          sessionId: row.sessionId,
        });
        if (turn) open(turn);
        else sayNothingWasStored();
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't open the terminal replay",
        });
      } finally {
        setOpeningSessionId(null);
      }
    },
    [projectId, utils],
  );

  const openReplay = useCallback(
    (row: SessionListRow) =>
      withLastTurn(row, (turn) =>
        openReplayHere({ turn, projectId, openDrawer }),
      ),
    [openDrawer, projectId, withLastTurn],
  );

  const openInExplorer = useCallback(
    (row: SessionListRow) =>
      withLastTurn(row, (turn) => {
        if (projectSlug) openReplayInExplorer({ turn, projectSlug, router });
      }),
    [projectSlug, router, withLastTurn],
  );

  const prefetch = useCallback(
    (row: SessionListRow) => {
      void utils.tracesV2.conversationContext.prefetch({
        projectId,
        conversationId: row.sessionId,
      });
    },
    [projectId, utils],
  );

  return { openingSessionId, openReplay, openInExplorer, prefetch };
}

/** The one turn a replay opens on: the last thing the session did. */
type ConversationTurn = { traceId: string; timestamp: number };

/** The session's last stored turn, or null when none of them was stored. */
async function lastTurnOfSession({
  utils,
  projectId,
  sessionId,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  sessionId: string;
}): Promise<ConversationTurn | null> {
  const context = await utils.tracesV2.conversationContext.fetch({
    projectId,
    conversationId: sessionId,
  });
  return context?.turns[context.turns.length - 1] ?? null;
}

/**
 * A session that reported its usage but stored none of its turns has nothing
 * to replay. That is a real state of the data rather than a failure, so it is
 * told plainly instead of as an error.
 */
function sayNothingWasStored(): void {
  toaster.create({
    title: "No stored traces for this session yet",
    description:
      "This session reported its usage, but none of its turns were stored, so there is nothing to replay.",
    type: "info",
  });
}

/**
 * Open the replay over the table. The store is what the global drawer mount
 * watches, so pushing it before the URL lands means the drawer opens on the
 * same frame as the click. The view mode is set transiently: this reader asked
 * for one replay, not for every trace they open next to be a terminal.
 *
 * The project travels with the trace, in the store and in the URL. These rows
 * are read from the caller's personal workspace while the app chrome is still
 * sitting in whichever project they last visited, so a drawer left to resolve
 * the project itself would query the wrong one and report the trace missing.
 */
function openReplayHere({
  turn,
  projectId,
  openDrawer,
}: {
  turn: ConversationTurn;
  projectId: string;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}): void {
  const store = useDrawerStore.getState();
  store.openTrace(turn.traceId, turn.timestamp, { projectId });
  store.setViewModeTransient("terminal");
  openDrawer("traceV2Details", {
    traceId: turn.traceId,
    t: String(turn.timestamp),
    mode: "terminal",
    projectId,
  });
}

/** Open the same replay in the full trace explorer, on its own page. */
function openReplayInExplorer({
  turn,
  projectSlug,
  router,
}: {
  turn: ConversationTurn;
  projectSlug: string;
  router: ReturnType<typeof useRouter>;
}): void {
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": turn.traceId,
    "drawer.t": String(turn.timestamp),
    "drawer.mode": "terminal",
  });
  void router.push(`/${projectSlug}/traces?${params.toString()}`);
}

const TableHeaderRow: React.FC<{
  sort: SessionsSortState;
  onSort: (column: SessionsSortColumn) => void;
}> = ({ sort, onSort }) => (
  <Table.Header>
    <Table.Row>
      <SortableColumnHeader
        label="Session"
        column="session"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Agent"
        column="agent"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Last update"
        column="lastUpdate"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Context"
        column="context"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortableColumnHeader
        label="Compactions"
        column="compactions"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Active and waiting"
        column="activeTime"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Token cost"
        column="cost"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortableColumnHeader
        label="Pull requests"
        column="pullRequests"
        sort={sort}
        onSort={onSort}
      />
      <Table.ColumnHeader width={12} />
    </Table.Row>
  </Table.Header>
);

const SessionRow: React.FC<{
  row: SessionListRow;
  largestPeak: number;
  largestCost: number;
  isOpening: boolean;
  onOpenReplay: () => void;
  onOpenInExplorer: (() => void) | undefined;
  onPrefetch: () => void;
}> = ({
  row,
  largestPeak,
  largestCost,
  isOpening,
  onOpenReplay,
  onOpenInExplorer,
  onPrefetch,
}) => (
  <Table.Row
    onClick={onOpenReplay}
    onMouseEnter={onPrefetch}
    aria-busy={isOpening}
    cursor="pointer"
    _hover={{ bg: "bg.subtle" }}
  >
    <Table.Cell maxWidth="320px">
      <SessionNameCell row={row} isOpening={isOpening} />
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted" whiteSpace="nowrap">
      {row.agent ? <AgentLabel agent={row.agent} /> : MISSING_VALUE}
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted" whiteSpace="nowrap">
      {formatLastUpdate({ timestampMs: row.lastUpdateAtMs })}
    </Table.Cell>
    <Table.Cell textAlign="end">
      <ContextCell row={row} largestPeak={largestPeak} />
    </Table.Cell>
    <Table.Cell>
      <CompactionsCell row={row} />
    </Table.Cell>
    <Table.Cell>
      <ActiveAndWaitingCell row={row} />
    </Table.Cell>
    <Table.Cell textAlign="end">
      <TokenCostCell row={row} largestCost={largestCost} />
    </Table.Cell>
    <Table.Cell>
      <PullRequestsCell pullRequests={row.pullRequests} />
    </Table.Cell>
    <Table.Cell>
      <RowActionsMenu
        row={row}
        onOpenReplay={onOpenReplay}
        onOpenInExplorer={onOpenInExplorer}
      />
    </Table.Cell>
  </Table.Row>
);

/**
 * What the session was called, over where it ran.
 *
 * A session whose agent never named it, and one whose title this reader may
 * not see, both read as untitled: the row is still worth listing for what it
 * consumed, and the branch under it says which piece of work it was.
 */
const SessionNameCell: React.FC<{
  row: SessionListRow;
  isOpening: boolean;
}> = ({ row, isOpening }) => {
  const where = [row.repositoryFullName, row.gitBranch]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    <VStack align="start" gap={0} minWidth={0}>
      <HStack gap={2} minWidth={0} width="full">
        {row.title ? (
          <Text fontSize="sm" fontWeight="medium" truncate>
            {row.title}
          </Text>
        ) : (
          <Text fontSize="sm" color="fg.muted" truncate>
            Untitled session
          </Text>
        )}
        {isOpening ? (
          <Spinner size="xs" color="fg.muted" flexShrink={0} />
        ) : null}
      </HStack>
      {where === "" ? null : (
        <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate>
          {where}
        </Text>
      )}
    </VStack>
  );
};

/**
 * The two token figures that answer different questions, and a bar comparing
 * the first against the heaviest session on the page.
 *
 * Peak context is how much the session was carrying when it was heaviest,
 * which is what decides whether it was about to compact; the total is what it
 * consumed over its whole life. The column sorts by the total, because a
 * reader ordering it is asking what the session cost.
 */
const ContextCell: React.FC<{
  row: SessionListRow;
  largestPeak: number;
}> = ({ row, largestPeak }) => {
  if (row.peakContextTokens === 0 && row.totalTokens === 0) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  return (
    <Tooltip
      content="Peak is the largest context carried into a single model call. Total is every token the session consumed."
      positioning={{ placement: "left" }}
    >
      <VStack align="stretch" gap={1} cursor="help" tabIndex={0}>
        <VStack align="end" gap={0}>
          <Text fontSize="sm">Peak {formatTokens(row.peakContextTokens)}</Text>
          <Text fontSize="xs" color="fg.muted">
            Total {formatTokens(row.totalTokens)}
          </Text>
        </VStack>
        <ComparisonBar value={row.peakContextTokens} largest={largestPeak} />
      </VStack>
    </Tooltip>
  );
};

/**
 * How often the session had to throw context away, and how often it had to
 * pay for a cache it had already built. A session that did neither says so
 * with the same placeholder every other absent value uses.
 */
const CompactionsCell: React.FC<{ row: SessionListRow }> = ({ row }) => {
  if (row.compactions === 0 && row.cacheRebuildCount === 0) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  const explanations = [
    row.compactions > 0
      ? `Compacted from ${formatTokens(row.compactionTokensBefore)} to ${formatTokens(row.compactionTokensAfter)} tokens`
      : null,
    row.cacheRebuildCount > 0
      ? `Largest cache rebuild ${formatTokens(row.largestCacheRebuildTokens)} tokens`
      : null,
  ].filter((line): line is string => line !== null);

  return (
    <Tooltip
      content={
        <VStack align="start" gap={0.5}>
          {explanations.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </VStack>
      }
      positioning={{ placement: "left" }}
    >
      <VStack align="start" gap={0} cursor="help" tabIndex={0}>
        {row.compactions > 0 ? (
          <Text fontSize="sm" whiteSpace="nowrap">
            {row.compactions}{" "}
            {row.compactions === 1 ? "compaction" : "compactions"}
          </Text>
        ) : null}
        {row.cacheRebuildCount > 0 ? (
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
            {row.cacheRebuildCount}{" "}
            {row.cacheRebuildCount === 1 ? "cache rebuild" : "cache rebuilds"}
          </Text>
        ) : null}
      </VStack>
    </Tooltip>
  );
};

/**
 * How long the agent worked against how long it stood waiting on its human.
 * The second figure is usually the one nobody had measured, and it is what
 * turns "the session took all afternoon" into something actionable.
 */
const ActiveAndWaitingCell: React.FC<{ row: SessionListRow }> = ({ row }) => {
  const waitingSeconds = row.blockedOnUserMs / 1000;
  if (row.activeTimeCliSec === 0 && waitingSeconds === 0) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  return (
    <VStack align="start" gap={0}>
      {row.activeTimeCliSec > 0 ? (
        <Text fontSize="sm" whiteSpace="nowrap">
          {formatDurationSeconds(row.activeTimeCliSec)} active
        </Text>
      ) : null}
      {waitingSeconds > 0 ? (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
          {formatDurationSeconds(waitingSeconds)} waiting
        </Text>
      ) : null}
    </VStack>
  );
};

/** What the session's tokens cost, against the dearest one on the page. */
const TokenCostCell: React.FC<{
  row: SessionListRow;
  largestCost: number;
}> = ({ row, largestCost }) => {
  if (row.costUsd === null) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="sm" textAlign="end">
        {formatCost(row.costUsd)}
      </Text>
      <ComparisonBar value={row.costUsd} largest={largestCost} />
    </VStack>
  );
};

/**
 * How this row's value compares to the largest on the page, drawn quietly
 * enough that the number stays the thing being read.
 */
const ComparisonBar: React.FC<{ value: number; largest: number }> = ({
  value,
  largest,
}) => (
  <Box height="3px" bg="border.subtle" borderRadius="full" overflow="hidden">
    <Box
      height="full"
      width={`${largest > 0 ? (value / largest) * 100 : 0}%`}
      bg="blue.fg"
      borderRadius="full"
    />
  </Box>
);

/**
 * What the session shipped. A session that lands a change, moves to the next
 * branch and opens a second pull request is one session with two, so the row
 * names each of them and links out; past a handful the rest go behind a hover
 * rather than pushing every other column off the page.
 */
const PullRequestsCell: React.FC<{
  pullRequests: readonly SessionPullRequest[];
}> = ({ pullRequests }) => {
  if (pullRequests.length === 0) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  const listed = pullRequests.slice(0, MAX_LISTED_PULL_REQUESTS);
  const rest = pullRequests.slice(MAX_LISTED_PULL_REQUESTS);

  return (
    <HStack gap={2} whiteSpace="nowrap">
      {listed.map((pullRequest) => (
        // The row opens the replay; this link leaves for GitHub, so it stops
        // the click from reaching the row underneath it.
        <Link
          key={pullRequest.number}
          href={pullRequest.url}
          isExternal
          color="fg.muted"
          fontFamily="mono"
          fontSize="sm"
          onClick={(event) => event.stopPropagation()}
        >
          #{pullRequest.number}
        </Link>
      ))}
      {rest.length > 0 ? (
        <Tooltip
          content={
            <VStack align="start" gap={0.5}>
              {rest.map((pullRequest) => (
                <Text key={pullRequest.number}>
                  #{pullRequest.number} {pullRequest.title}
                </Text>
              ))}
            </VStack>
          }
          positioning={{ placement: "left" }}
        >
          {/* The remaining numbers are written down nowhere else on this row,
              so the hover has a tab stop behind it. */}
          <Text
            as="span"
            fontSize="sm"
            color="fg.muted"
            cursor="help"
            tabIndex={0}
          >
            +{rest.length}
          </Text>
        </Tooltip>
      ) : null}
    </HStack>
  );
};

const RowActionsMenu: React.FC<{
  row: SessionListRow;
  onOpenReplay: () => void;
  onOpenInExplorer: (() => void) | undefined;
}> = ({ row, onOpenReplay, onOpenInExplorer }) => (
  // The row itself opens the replay, so every control inside it has to stop
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
          aria-label={`Actions for ${row.title ?? "untitled session"}`}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="replay" onClick={onOpenReplay}>
          Open terminal replay
        </Menu.Item>
        {onOpenInExplorer ? (
          <Menu.Item value="explorer" onClick={onOpenInExplorer}>
            View on Trace Explorer
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  </div>
);

/** The read's row, with the figures the table orders and narrows by. */
function toListRow(row: SessionPayload): SessionListRow {
  return {
    ...row,
    repositoryFullName:
      row.repositoryOwner && row.repositoryName
        ? `${row.repositoryOwner}/${row.repositoryName}`
        : "",
    lastUpdateAtMs: sessionLastUpdateAtMs(row),
    totalTokens: sessionTotalTokens(row),
  };
}

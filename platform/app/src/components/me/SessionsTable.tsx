import { Skeleton, Table, Text, VStack } from "@chakra-ui/react";
import {
  type SessionListRow,
  type SessionsSortColumn,
  type SessionsSortState,
  SessionsTableHeader,
  isWithinPeriod,
  matchesSessionSearch,
  type PeriodSelection,
  toListRow,
  useSessionsSort,
} from "@langwatch/coding-agent-web";
import { SquareTerminal } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { ListTable } from "~/components/ui/ListTable";
import { Pagination } from "~/components/ui/Pagination";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { SessionRow } from "./sessions/SessionRow";
import { SessionsToolbar } from "./sessions/SessionsToolbar";
import { useTerminalReplay } from "./sessions/useTerminalReplay";

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

  return <ListedSessions projectId={projectId} projectSlug={projectSlug} rows={rows} />;
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
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection | null>(null);

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
  const { openDrawer } = useDrawer();
  const largestTotal = rows.reduce((max, row) => Math.max(max, row.totalTokens), 0);
  const largestCost = rows.reduce((max, row) => Math.max(max, row.costUsd ?? 0), 0);

  return (
    <>
      <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
        <SessionsTableHeader sort={sort} onSort={onSort} />
        <Table.Body>
          {rows.map((row) => (
            <SessionRow
              key={row.sessionId}
              row={row}
              largestTotal={largestTotal}
              largestCost={largestCost}
              isOpening={replay.openingSessionId === row.sessionId}
              onOpenReplay={() => void replay.openReplay(row)}
              onOpenInExplorer={
                projectSlug ? () => void replay.openInExplorer(row) : undefined
              }
              onOpenPullRequest={(pullRequest) =>
                openDrawer("pullRequestDetail", {
                  projectId,
                  repositoryHost: row.repositoryHost,
                  repositoryFullName: row.repositoryFullName,
                  prNumber: pullRequest.number,
                })
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

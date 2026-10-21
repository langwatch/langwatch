import { ListTable } from "@langwatch/design-system/list-table";
import { type EmptyNext, NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Pagination } from "@langwatch/design-system/pagination";
import { Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { SquareTerminal } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { codingAgentApi as api } from "../../behavior/coding-agent-api.ts";
import { useCodingAgentRouter } from "../../behavior/coding-agent-router.ts";
import { type SessionListRow, toListRow } from "../../behavior/session-list-row.ts";
import {
  type SessionsSortColumn,
  type SessionsSortState,
  useSessionsSort,
} from "../../behavior/session-sort.ts";
import { useTerminalReplay } from "../../behavior/use-terminal-replay.ts";
import {
  decodePullRequestRef,
  encodePullRequestRef,
  PULL_REQUEST_QUERY_KEY,
} from "../../model/pull-request-detail-address.ts";
import {
  isWithinPeriod,
  matchesSessionSearch,
  type PeriodSelection,
} from "../../model/session-filters.ts";
import { sessionIdentityKey, spansSeveralProjects } from "../../model/session-identity.ts";
import { SessionRow } from "../blocks/session-row.tsx";
import { SessionsTableHeader } from "../blocks/sessions-table-header.tsx";
import { SessionsToolbar } from "../blocks/sessions-toolbar.tsx";
import { PullRequestDetailDrawer } from "./pull-request-detail-drawer.tsx";

/** Sessions table (last quarter); answers "on what" for spend. Replays in terminal. */

const SESSIONS_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "How sessions are recorded",
    href: "https://docs.langwatch.ai/coding-agents/sessions",
  },
];

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
  const rows: SessionListRow[] = (sessionsQuery.data ?? []).map(toListRow);

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
        next={SESSIONS_NEXT}
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

  const filteredRows = rows.filter(
    (row) =>
      matchesSessionSearch({ row, query: search }) &&
      isWithinPeriod({
        lastUpdateAtMs: row.lastUpdateAtMs,
        period: periodSelection?.period ?? null,
      }),
  );
  // Decided over every listed row, not one page, so the project line stays put while paging.
  const showProject = spansSeveralProjects(rows);
  const { sorted, sort, onSort } = useSessionsSort({ rows: filteredRows });

  // A refetch, a search or a narrower period can leave fewer rows than the page
  // the reader is already on, and the pager clamps only what it prints. Slicing
  // on the stored page would empty the table under a footer reading "Page 1 of
  // 1", so the slice, the pager and the next click all work off the clamped
  // page.
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
        <NoDataInfoBlock
          size="line"
          title="No sessions match"
          action={{
            label: "Clear filters",
            onClick: () => {
              setSearch("");
              setPeriodSelection(null);
              setPage(1);
            },
          }}
          next={SESSIONS_NEXT}
        />
      ) : (
        <OnePageOfSessions
          projectId={projectId}
          projectSlug={projectSlug}
          rows={visibleRows}
          showProject={showProject}
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
 * The page the reader is looking at. Comparison bars are scaled per-column
 * against this page alone — a session can carry huge context and cost very
 * little, or the reverse, so a shared scale would misread both.
 */
const OnePageOfSessions: React.FC<{
  projectId: string;
  projectSlug: string | null;
  rows: SessionListRow[];
  /** Whether each row names its member project: only when the rows span several. */
  showProject: boolean;
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
  showProject,
  totalCount,
  page,
  pageSize,
  sort,
  onSort,
  onPageChange,
  onPageSizeChange,
}) => {
  const replay = useTerminalReplay({ projectId, projectSlug });
  const router = useCodingAgentRouter();
  // The pull request the detail drawer is open on lives in the address, so a
  // link to a session's pull request reopens it. See `pull-request-detail-address`.
  const openPullRequest = decodePullRequestRef(router.query[PULL_REQUEST_QUERY_KEY]);
  const largestTotal = rows.reduce((max, row) => Math.max(max, row.totalTokens), 0);
  const largestCost = rows.reduce((max, row) => Math.max(max, row.costUsd ?? 0), 0);

  return (
    <>
      <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
        <SessionsTableHeader sort={sort} onSort={onSort} />
        <ListTable.Body>
          {rows.map((row) => (
            <SessionRow
              key={sessionIdentityKey(row)}
              row={row}
              showProject={showProject}
              largestTotal={largestTotal}
              largestCost={largestCost}
              isOpening={replay.isOpening(row)}
              onOpenReplay={() => void replay.openReplay(row)}
              onOpenInExplorer={projectSlug ? () => void replay.openInExplorer(row) : undefined}
              onOpenPullRequest={(pullRequest) =>
                router.setQueryParams({
                  [PULL_REQUEST_QUERY_KEY]: encodePullRequestRef({
                    repositoryHost: row.repositoryHost,
                    repositoryFullName: row.repositoryFullName,
                    prNumber: pullRequest.number,
                  }),
                })
              }
              onPrefetch={() => replay.prefetch(row)}
            />
          ))}
        </ListTable.Body>
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

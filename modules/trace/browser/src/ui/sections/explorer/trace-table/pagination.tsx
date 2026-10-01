import { type PageCursor, useExplorerStore } from "@langwatch/trace-browser-kit";
import { TRACE_LIST_MAX_OFFSET_ROWS } from "@langwatch/trace-contract";
import type React from "react";

import { useTraceTableScrollElement } from "../../../../behavior/explorer/trace-table/scroll-context.ts";
import { Pagination as PaginationBar } from "../../../elements/pagination.tsx";
import { useExplorerCounts } from "../hooks/use-explorer-counts.ts";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

interface PaginationProps {
  /** Cursor returned by the current batch; null means the end. */
  nextCursor?: PageCursor | null;
  visibleCount?: number;
  /**
   * Renders a placeholder bar in place of the page description while data is loading,
   * so the pagination row doesn't pop in when the first page resolves.
   */
  isLoading?: boolean;
  /** Prevent page-racing only while a different page key is replacing data. */
  isTransitioning?: boolean;
  /**
   * Upper bound of the active lens's page-size domain. The rows-per-page preference is
   * shared across lenses, so a larger persisted value clamps to this bound for the
   * range copy and the highlighted option, and sizes beyond it are not offered.
   */
  maxPageSize?: number;
}

/**
 * Which page numbers the sessions lens can open.
 */
function reachableWithCursorsOnly({
  page,
  currentPage,
  pageCursors,
  nextCursor,
}: {
  page: number;
  currentPage: number;
  pageCursors: Record<number, PageCursor | null>;
  nextCursor: PageCursor | null;
}): boolean {
  if (page === 1 || page === currentPage) return true;
  if (pageCursors[page] !== undefined) return true;
  return page === currentPage + 1 && nextCursor !== null;
}

/**
 * Store-driven pagination for the trace table: translates the explorer store's page
 * state into the shared bar's props, one translation per lens. The total and its noun
 * come from `useExplorerCounts`, the read every count on the page shares.
 */
export const Pagination: React.FC<PaginationProps> = ({
  nextCursor = null,
  visibleCount = 0,
  isLoading = false,
  isTransitioning = false,
  maxPageSize,
}) => {
  // One string for both surfaces: the pagination line and the sidebar total render
  // the same `summary`, so neither the number nor the noun can differ between them.
  const { totalHits, summary } = useExplorerCounts();
  const page = useExplorerStore((s) => s.page);
  const pageSize = useExplorerStore((s) => s.pageSize);
  const pageCursors = useExplorerStore((s) => s.pageCursors);
  const setPage = useExplorerStore((s) => s.setPage);
  const setPageCursor = useExplorerStore((s) => s.setPageCursor);
  const setPageSize = useExplorerStore((s) => s.setPageSize);
  const cursorOnly = useExplorerStore((s) => s.grouping) === "by-conversation";
  const scrollElement = useTraceTableScrollElement();

  // The size the data source actually pages by, which is what the range
  // copy must count by when the shared preference exceeds the lens's cap.
  const effectivePageSize = maxPageSize !== undefined ? Math.min(pageSize, maxPageSize) : pageSize;
  const sizeOptions =
    maxPageSize !== undefined
      ? PAGE_SIZE_OPTIONS.filter((size) => size <= maxPageSize)
      : PAGE_SIZE_OPTIONS;

  const currentPage = Math.max(page, 1);
  // A background refresh of the CURRENT page must not lock navigation. On a
  // busy live project SSE can keep `isFetching` true almost continuously;
  // disabling the pager for that signal made pagination appear broken. Only a
  // key transition (React Query is showing previous-page data) is a page lock.
  const busy = isLoading || isTransitioning;

  const goToPage = (nextPage: number) => {
    if (busy || nextPage === currentPage) return;
    // The batch on screen already carries the cursor that enters the one after
    // it, so a step forward stays on the keyset path; every other jump reads
    // by position.
    if (nextPage === currentPage + 1 && nextCursor) {
      setPageCursor({ page: nextPage, cursor: nextCursor });
    }
    setPage(nextPage);
    scrollElement?.scrollTo({ top: 0, behavior: "auto" });
  };

  return (
    <PaginationBar
      page={currentPage}
      pageSize={effectivePageSize}
      totalCount={totalHits}
      totalSummary={summary}
      visibleCount={visibleCount}
      pageSizeOptions={sizeOptions}
      isLoading={isLoading}
      navDisabled={isTransitioning}
      canGoNext={cursorOnly ? nextCursor !== null : undefined}
      isPageReachable={
        cursorOnly
          ? (candidate) =>
              reachableWithCursorsOnly({
                page: candidate,
                currentPage,
                pageCursors,
                nextCursor,
              })
          : // A numbered jump reads by position, and the server refuses
            // position reads past the window. Deeper pages stay reachable the
            // way the sessions lens reaches everything: with a cursor.
            (candidate) =>
              candidate * effectivePageSize <= TRACE_LIST_MAX_OFFSET_ROWS ||
              reachableWithCursorsOnly({
                page: candidate,
                currentPage,
                pageCursors,
                nextCursor,
              })
      }
      onPageChange={goToPage}
      onPageSizeChange={setPageSize}
    />
  );
};

import type React from "react";
import { Pagination as PaginationBar } from "../../../elements/pagination";
import { TRACE_LIST_MAX_OFFSET_ROWS } from "@langwatch/trace-contract";
import type { PageCursor } from "../../../../index";
import { useFilterStore, useViewStore } from "../../../../index";
import { useTraceTableScrollElement } from "../../../../behavior/explorer/trace-table/scroll-context";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

interface PaginationProps {
  totalHits: number;
  /** Cursor returned by the current batch; null means the end. */
  nextCursor?: PageCursor | null;
  visibleCount?: number;
  /** What one row is, for the totals copy: "traces" (default) or "conversations". */
  itemNoun?: string;
  /**
   * Renders a placeholder bar in place of the page description while data is
   * loading, so the pagination row doesn't pop in when the first page
   * resolves. The pager keeps rendering; its disabled state doesn't change
   * between loading and loaded for the initial page, and it anchors the row's
   * height.
   */
  isLoading?: boolean;
  /** Prevent page-racing only while a different page key is replacing data. */
  isTransitioning?: boolean;
  /**
   * Upper bound of the active lens's page-size domain. The rows-per-page
   * preference is shared across lenses, so a larger persisted value clamps
   * to this bound for the range copy and the highlighted option, and sizes
   * beyond it are not offered. Unset means the full option list applies.
   */
  maxPageSize?: number;
}

/**
 * Which page numbers the sessions lens can open. `tracesV2.sessions` reads by
 * cursor alone, so a page is reachable only once something has handed us the
 * cursor that enters it: the first batch, any batch already walked, the one on
 * screen, and the one the current batch's cursor points at.
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
 * Store-driven pagination for the trace table: translates the filter store's
 * page state into the shared bar's props, one translation per lens.
 *
 * The flat lens's endpoint falls back to an offset read when no cursor is
 * passed, so every page number is jumpable; the cursor is still used for the
 * one step the current batch already knows about, which keeps sequential
 * paging keyset-fast. The sessions lens has no offset path at all, so it
 * offers only the pages a cursor can reach.
 */
export const Pagination: React.FC<PaginationProps> = ({
  totalHits,
  nextCursor = null,
  visibleCount = 0,
  itemNoun = "traces",
  isLoading = false,
  isTransitioning = false,
  maxPageSize,
}) => {
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const pageCursors = useFilterStore((s) => s.pageCursors);
  const setPage = useFilterStore((s) => s.setPage);
  const setPageCursor = useFilterStore((s) => s.setPageCursor);
  const setPageSize = useFilterStore((s) => s.setPageSize);
  const cursorOnly = useViewStore((s) => s.grouping) === "by-conversation";
  const scrollElement = useTraceTableScrollElement();

  // The size the data source actually pages by, which is what the range
  // copy must count by when the shared preference exceeds the lens's cap.
  const effectivePageSize =
    maxPageSize !== undefined ? Math.min(pageSize, maxPageSize) : pageSize;
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
      unitLabel={itemNoun}
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

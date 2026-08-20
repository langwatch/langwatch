// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { useCallback, useEffect, useRef, useState } from "react";

import {
  absorbFetch,
  buildPageRequest,
  type PageRequest,
  type PagerRow,
  paginationView,
  stallSkipRequest,
} from "../logic/eventsPager";

/**
 * Cursor walk over `eventsForSource`, shaped for the pagination bar.
 *
 * Pages once loaded are kept in memory and never re-asked from the
 * server, and the first page's time anchor is fixed by its cursor
 * chain — so walking back always lands on the exact rows the admin
 * came from, even while new events keep arriving upstream. The fetch
 * itself is injected, which keeps the whole walk testable against a
 * fake server.
 */
export type SourceEventsPager<R extends PagerRow> = {
  /** Loading covers only the very first page; later walks set isFetching. */
  status: "loading" | "error" | "ready";
  error: unknown;
  page: number;
  pageSize: number;
  /** Rows of the page currently shown. */
  rows: R[];
  /** Every row loaded across all visited pages. */
  loadedCount: number;
  totalCount: number;
  canGoNext: boolean;
  isPageReachable: (page: number) => boolean;
  isFetching: boolean;
  goToPage: (page: number) => void;
  setPageSize: (size: number) => void;
};

/**
 * One step of the walk: build the request for the page after
 * `displayedRows`, fetch, and absorb — falling back to a skip past the
 * boundary when a tied millisecond is wider than one fetch, rather than
 * re-reading the same window forever.
 */
async function walkOnePage<R extends PagerRow>({
  pageSize,
  displayedRows,
  fetchPage,
}: {
  pageSize: number;
  displayedRows: readonly R[];
  fetchPage: (request: PageRequest) => Promise<R[]>;
}): Promise<{ rows: R[]; hasMore: boolean }> {
  const request = buildPageRequest({ pageSize, displayedRows });
  const result = absorbFetch({
    pageSize,
    request,
    fetched: await fetchPage(request),
  });
  if (!result.stalled) return result;
  const skip = stallSkipRequest({ pageSize, displayedRows });
  return absorbFetch({
    pageSize,
    request: skip,
    fetched: await fetchPage(skip),
  });
}

export function useSourceEventsPager<R extends PagerRow>({
  enabled,
  initialPageSize = 25,
  fetchPage,
}: {
  enabled: boolean;
  initialPageSize?: number;
  fetchPage: (request: PageRequest) => Promise<R[]>;
}): SourceEventsPager<R> {
  const [pages, setPages] = useState<R[][] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [isFetching, setIsFetching] = useState(false);
  // Bumped on every reset; in-flight fetches from before a reset land
  // in a world that no longer exists and must be discarded.
  const generationRef = useRef(0);

  const fetchNextPage = useCallback(
    async (currentPages: R[][] | null, currentPageSize: number) => {
      const generation = generationRef.current;
      setIsFetching(true);
      try {
        const result = await walkOnePage({
          pageSize: currentPageSize,
          displayedRows: currentPages?.flat() ?? [],
          fetchPage,
        });
        if (generationRef.current !== generation) return;
        const nextPages = [...(currentPages ?? [])];
        if (result.rows.length > 0 || nextPages.length === 0) {
          nextPages.push(result.rows);
        }
        setPages(nextPages);
        setHasMore(result.rows.length > 0 && result.hasMore);
        setPage(nextPages.length);
      } catch (fetchError) {
        if (generationRef.current !== generation) return;
        setError(fetchError);
      } finally {
        if (generationRef.current === generation) setIsFetching(false);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    if (!enabled || pages !== null || error !== null || isFetching) return;
    void fetchNextPage(null, pageSize);
  }, [enabled, pages, error, isFetching, pageSize, fetchNextPage]);

  const goToPage = useCallback(
    (target: number) => {
      if (target < 1 || pages === null || isFetching) return;
      if (target <= pages.length) {
        setPage(target);
        return;
      }
      if (target === pages.length + 1 && hasMore) {
        void fetchNextPage(pages, pageSize);
      }
    },
    [pages, isFetching, hasMore, pageSize, fetchNextPage],
  );

  const setPageSize = useCallback((size: number) => {
    generationRef.current += 1;
    setPages(null);
    setPage(1);
    setHasMore(false);
    setError(null);
    setIsFetching(false);
    setPageSizeState(size);
  }, []);

  const loadedPages = pages?.length ?? 0;
  const loadedCount = pages?.reduce((sum, p) => sum + p.length, 0) ?? 0;
  const view = paginationView({ loadedCount, loadedPages, hasMore });

  return {
    status: error !== null ? "error" : pages === null ? "loading" : "ready",
    error,
    page,
    pageSize,
    rows: pages?.[page - 1] ?? [],
    loadedCount,
    totalCount: view.totalCount,
    canGoNext: view.canGoNext,
    isPageReachable: view.isPageReachable,
    isFetching,
    goToPage,
    setPageSize,
  };
}

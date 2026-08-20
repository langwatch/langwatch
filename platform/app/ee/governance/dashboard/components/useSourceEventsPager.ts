// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { useCallback, useEffect, useReducer, useRef } from "react";

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
  /** Loading covers only the very first page; later walks set
   * isFetching. "error" means nothing ever loaded — a failure with
   * pages on screen keeps status "ready" and travels in `error`. */
  status: "loading" | "error" | "ready";
  /** The last walk's failure, if any; cleared when a new fetch starts. */
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

type PagerState<R extends PagerRow> = {
  pages: R[][] | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  error: unknown;
  isFetching: boolean;
  /** Bumped on every reset; a fetch started before a reset landed in a
   * world that no longer exists and its result is discarded. */
  generation: number;
};

type PagerAction<R extends PagerRow> =
  | { type: "reset" }
  | { type: "resize"; pageSize: number }
  | { type: "fetchStart" }
  | { type: "fetchLanded"; generation: number; rows: R[]; hasMore: boolean }
  | { type: "fetchFailed"; generation: number; error: unknown }
  | { type: "show"; page: number };

const initPagerState = <R extends PagerRow>(
  pageSize: number,
): PagerState<R> => ({
  pages: null,
  page: 1,
  pageSize,
  hasMore: false,
  error: null,
  isFetching: false,
  generation: 0,
});

function landFetch<R extends PagerRow>({
  state,
  rows,
  hasMore,
}: {
  state: PagerState<R>;
  rows: R[];
  hasMore: boolean;
}): PagerState<R> {
  const pages = [...(state.pages ?? [])];
  // An empty page is only kept as the very first one — it is how "this
  // source has no events" is represented; later empty results just end
  // the walk on the page already shown.
  if (rows.length > 0 || pages.length === 0) pages.push(rows);
  return {
    ...state,
    pages,
    page: pages.length,
    hasMore: rows.length > 0 && hasMore,
    isFetching: false,
  };
}

/**
 * A landing only counts while its walk is still the current one: same
 * generation AND a fetch still marked in flight. The second guard makes
 * a duplicated start (StrictMode's double effect run) harmless — the
 * first landing clears `isFetching`, so the echo is dropped instead of
 * appended as a phantom page.
 */
const isCurrentWalk = <R extends PagerRow>(
  state: PagerState<R>,
  generation: number,
) => generation === state.generation && state.isFetching;

function pagerReducer<R extends PagerRow>(
  state: PagerState<R>,
  action: PagerAction<R>,
): PagerState<R> {
  switch (action.type) {
    case "reset":
      return {
        ...initPagerState<R>(state.pageSize),
        generation: state.generation + 1,
      };
    case "resize":
      return {
        ...initPagerState<R>(action.pageSize),
        generation: state.generation + 1,
      };
    case "fetchStart":
      // Starting a walk is also the retry: a failure from the previous
      // attempt stops being true the moment a new fetch is in flight.
      return { ...state, isFetching: true, error: null };
    case "fetchLanded":
      return isCurrentWalk(state, action.generation)
        ? landFetch({ state, rows: action.rows, hasMore: action.hasMore })
        : state;
    case "fetchFailed":
      return isCurrentWalk(state, action.generation)
        ? { ...state, error: action.error, isFetching: false }
        : state;
    case "show":
      return { ...state, page: action.page };
  }
}

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
  if (!result.isStalled) return result;
  const skip = stallSkipRequest({ pageSize, displayedRows });
  return absorbFetch({
    pageSize,
    request: skip,
    fetched: await fetchPage(skip),
  });
}

/** The state, shaped for the table and the pagination bar. */
function presentPager<R extends PagerRow>({
  state,
  controls,
}: {
  state: PagerState<R>;
  controls: Pick<SourceEventsPager<R>, "goToPage" | "setPageSize">;
}): SourceEventsPager<R> {
  const loadedCount = state.pages?.reduce((sum, p) => sum + p.length, 0) ?? 0;
  const view = paginationView({
    pageSize: state.pageSize,
    loadedPages: state.pages?.length ?? 0,
    lastPageCount: state.pages?.[state.pages.length - 1]?.length ?? 0,
    hasMore: state.hasMore,
  });
  return {
    // A failure with pages on screen is not the table's whole story:
    // "error" is reserved for a walk that never loaded anything. A
    // mid-walk failure keeps status "ready" and travels in `error`.
    status:
      state.pages === null
        ? state.error !== null
          ? "error"
          : "loading"
        : "ready",
    error: state.error,
    page: state.page,
    pageSize: state.pageSize,
    rows: state.pages?.[state.page - 1] ?? [],
    loadedCount,
    totalCount: view.totalCount,
    canGoNext: view.canGoNext,
    isPageReachable: view.isPageReachable,
    isFetching: state.isFetching,
    ...controls,
  };
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
  const [state, dispatch] = useReducer(
    (current: PagerState<R>, action: PagerAction<R>) =>
      pagerReducer(current, action),
    initialPageSize,
    initPagerState<R>,
  );

  const startFetch = useCallback(
    (snapshot: PagerState<R>) => {
      dispatch({ type: "fetchStart" });
      walkOnePage({
        pageSize: snapshot.pageSize,
        displayedRows: snapshot.pages?.flat() ?? [],
        fetchPage,
      }).then(
        ({ rows, hasMore }) =>
          dispatch({
            type: "fetchLanded",
            generation: snapshot.generation,
            rows,
            hasMore,
          }),
        (error: unknown) =>
          dispatch({
            type: "fetchFailed",
            generation: snapshot.generation,
            error,
          }),
      );
    },
    [fetchPage],
  );

  // `fetchPage` closes over the org and source ids, so a new identity
  // means the walk now addresses different data — everything loaded so
  // far belongs to the previous source and must go. Without this, a
  // param-only route change (multi-hop history navigation between two
  // detail pages) keeps showing the old source's events.
  const previousFetchPageRef = useRef(fetchPage);
  useEffect(() => {
    if (previousFetchPageRef.current === fetchPage) return;
    previousFetchPageRef.current = fetchPage;
    dispatch({ type: "reset" });
  }, [fetchPage]);

  useEffect(() => {
    const untouched =
      state.pages === null && state.error === null && !state.isFetching;
    if (enabled && untouched) startFetch(state);
  }, [enabled, state, startFetch]);

  const goToPage = useCallback(
    (target: number) => {
      if (target < 1 || state.pages === null || state.isFetching) return;
      if (target <= state.pages.length) {
        dispatch({ type: "show", page: target });
      } else if (target === state.pages.length + 1 && state.hasMore) {
        startFetch(state);
      }
    },
    [state, startFetch],
  );

  const setPageSize = useCallback(
    (size: number) => dispatch({ type: "resize", pageSize: size }),
    [],
  );

  return presentPager({ state, controls: { goToPage, setPageSize } });
}

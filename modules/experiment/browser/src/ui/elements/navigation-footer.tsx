import { useRouter } from "@langwatch/browser-host/use-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Constants
const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250] as const;

/**
 * Represents cursor pagination information decoded from a scrollId
 */
interface CursorInfo {
  lastTimestamp: number;
  lastTraceId: string;
  pageSize: number;
  sortDirection: "asc" | "desc";
}

/**
 * Safely parses a URL query parameter to a number with fallback
 */
const parseQueryNumber = (value: string | string[] | undefined, fallback: number): number => {
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
};

/**
 * Decodes a base64-encoded cursor string into pagination information
 */
const decodeCursor = (scrollId: string | null): CursorInfo | null => {
  if (!scrollId) return null;

  try {
    const decoded = JSON.parse(atob(scrollId));
    return {
      lastTimestamp: decoded.lastTimestamp,
      lastTraceId: decoded.lastTraceId,
      pageSize: decoded.pageSize,
      sortDirection: decoded.sortDirection,
    };
  } catch (error) {
    console.warn("Failed to decode cursor:", error);
    return null;
  }
};

/**
 * How a list walks its pages.
 */
export type PaginationMode = "cursor" | "offset";

type PaginationOverrides = { pageOffset?: number; pageSize?: number; scrollId?: string | null };

/** A page's URL query: other params kept, defaults stripped, no `pageOffset` in cursor mode. */
const paginationQueryOf = ({
  query,
  pageOffset,
  pageSize,
  isCursorMode,
  overrides,
}: {
  query: Record<string, string | string[] | undefined>;
  pageOffset: number;
  pageSize: number;
  isCursorMode: boolean;
  overrides: PaginationOverrides;
}): Record<string, string | string[] | undefined> => {
  const { pageOffset: _po, pageSize: _ps, scrollId: _si, ...rest } = query;
  const next: Record<string, string | string[] | undefined> = { ...rest };
  const offset = overrides.pageOffset ?? pageOffset;
  const size = overrides.pageSize ?? pageSize;

  if (!isCursorMode && offset !== 0) next.pageOffset = offset.toString();
  if (size !== DEFAULT_PAGE_SIZE) next.pageSize = size.toString();
  if (overrides.scrollId) next.scrollId = overrides.scrollId;

  return next;
};

/**
 * One page back. Offset lists step by a page; cursor lists pop the cursor this
 * scroll came from, and with nothing walked yet replay from the first page.
 */
const stepBack = ({
  isCursorMode,
  pageOffset,
  pageSize,
  stack,
  setCursorPageNumber,
  goTo,
}: {
  isCursorMode: boolean;
  pageOffset: number;
  pageSize: number;
  stack: string[];
  setCursorPageNumber: (update: (prev: number) => number) => void;
  goTo: (overrides: PaginationOverrides) => void;
}): void => {
  if (!isCursorMode) {
    if (pageOffset > 0) goTo({ pageOffset: Math.max(0, pageOffset - pageSize) });
    return;
  }
  const previousScrollId = stack.pop();
  if (previousScrollId !== undefined) {
    setCursorPageNumber((prev) => Math.max(1, prev - 1));
    goTo({ scrollId: previousScrollId });
    return;
  }
  setCursorPageNumber(() => 1);
  goTo({ scrollId: null });
};

/**
 * Custom hook for managing navigation footer state and logic.
 * @param mode - see {@link PaginationMode}. Defaults to `offset`, which is the
 *   behaviour every caller had before the mode existed.
 */
export const useMessagesNavigationFooter = (mode: PaginationMode = "offset") => {
  const router = useRouter();
  const isCursorMode = mode === "cursor";

  const [totalHits, setTotalHits] = useState<number>(0);
  const [cursorPageNumber, setCursorPageNumber] = useState<number>(1);
  const cursorStackRef = useRef<string[]>([]);

  // In cursor mode a stale `pageOffset` in a bookmarked URL is ignored rather
  // than obeyed: the server rejects a non-zero one, so reading it here would
  // turn an old shared link into an error instead of a first page.
  const pageOffset = useMemo(
    () => (isCursorMode ? 0 : parseQueryNumber(router.query.pageOffset, 0)),
    [router.query.pageOffset, isCursorMode],
  );

  const pageSize = useMemo(
    () => parseQueryNumber(router.query.pageSize, DEFAULT_PAGE_SIZE),
    [router.query.pageSize],
  );

  const urlScrollId = isCursorMode ? (router.query.scrollId as string | null) : null;

  const cursorInfo = useMemo(() => decodeCursor(urlScrollId), [urlScrollId]);
  const estimatedTotalPages = Math.ceil(totalHits / (cursorInfo?.pageSize || pageSize));

  // Back at the first page (no cursor in the URL) the walked-cursor stack is
  // meaningless — drop it so "previous" cannot pop into a stale scroll.
  useEffect(() => {
    if (!urlScrollId) {
      setCursorPageNumber(1);
      cursorStackRef.current = [];
    }
  }, [urlScrollId]);

  // Build a query object with pagination params, stripping defaults to keep
  // the URL clean and avoid clobbering other params (like saved view filters).
  // In cursor mode `pageOffset` is stripped and never written back, so an old
  // link loses it rather than carrying a value the server will reject.
  const buildPaginationQuery = useCallback(
    (overrides: PaginationOverrides) =>
      paginationQueryOf({ query: router.query, pageOffset, pageSize, isCursorMode, overrides }),
    [router.query, pageOffset, pageSize, isCursorMode],
  );

  const goTo = useCallback(
    (overrides: PaginationOverrides) => {
      void router.push(
        { pathname: router.pathname, query: buildPaginationQuery(overrides) },
        { shallow: true },
      );
    },
    [router, buildPaginationQuery],
  );

  /** Open a 1-based page of an offset list, as a page picker names it. */
  const goToPage = (page: number) => goTo({ pageOffset: Math.max(0, (page - 1) * pageSize) });

  /**
   * Navigate to the next page
   * @param currentResponseScrollId - Scroll ID from the current response (for cursor pagination)
   */
  const nextPage = useCallback(
    (currentResponseScrollId?: string | null) => {
      if (currentResponseScrollId) {
        // Push the current scrollId so prevPage can pop back to it.
        if (urlScrollId) cursorStackRef.current.push(urlScrollId);
        setCursorPageNumber((prev) => prev + 1);
        goTo({ scrollId: currentResponseScrollId });
        return;
      }

      // In cursor mode no cursor in the response means no next page: only a stale
      // click reaches here, and advancing an offset would silently return page one.
      if (isCursorMode) return;

      goTo({ pageOffset: pageOffset + pageSize });
    },
    [pageOffset, pageSize, isCursorMode, urlScrollId, goTo],
  );

  /**
   * Navigate to the previous page
   */
  const prevPage = useCallback(() => {
    stepBack({
      isCursorMode,
      pageOffset,
      pageSize,
      stack: cursorStackRef.current,
      setCursorPageNumber,
      goTo,
    });
  }, [pageOffset, pageSize, isCursorMode, goTo]);

  /**
   * Change the page size and reset pagination
   * @param size - New page size
   */
  const changePageSize = useCallback(
    (size: number) => {
      void router.push(
        {
          pathname: router.pathname,
          query: buildPaginationQuery({
            pageSize: size,
            // Resizing means starting over in BOTH modes: a cursor describes a
            // position at the old size, and an offset counts rows at the old
            // size, so keeping either lands the user in the wrong place. In
            // cursor mode the offset is stripped from the URL anyway, which is
            // why this is safe to pass unconditionally.
            pageOffset: 0,
            scrollId: null,
          }),
        },
        { shallow: true },
      );
    },
    [router, buildPaginationQuery],
  );

  /**
   * @param traceGroups - TRPC query result
   */
  const useUpdateTotalHits = (queryResult: {
    isFetched?: boolean;
    data?: { totalHits?: number };
  }) => {
    useEffect(() => {
      if (queryResult.isFetched) {
        const totalHits: number = queryResult.data?.totalHits ?? 0;
        setTotalHits(totalHits);
      }
    }, [queryResult.data?.totalHits, queryResult.isFetched, queryResult.data]);
  };

  // Reset pagination when search query changes
  const prevQueryRef = useRef(router.query.query);
  useEffect(() => {
    if (!router.query.project) return;

    // Skip if the search query hasn't actually changed (e.g. initial mount)
    if (prevQueryRef.current === router.query.query) return;
    prevQueryRef.current = router.query.query;

    void router.push(
      {
        pathname: router.pathname,
        query: buildPaginationQuery({
          pageSize: DEFAULT_PAGE_SIZE,
          // A new search is a new result set, so neither a cursor nor an offset
          // into the old one survives it. Same reasoning as changePageSize.
          pageOffset: 0,
          scrollId: null,
        }),
      },
      { shallow: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.query]);

  return {
    mode,
    totalHits,
    pageOffset,
    pageSize,
    // Past the first page of a cursor list the exact item range is unknowable:
    // such a URL can be opened cold, so the page counter is local state rather
    // than something derived from the link. The footer says "page N of about M"
    // there and gives an exact range everywhere else, where it is exact.
    isPastFirstPage: !!urlScrollId,
    cursorInfo,
    cursorPageNumber,
    estimatedTotalPages,
    nextPage,
    prevPage,
    changePageSize,
    goToPage,
    useUpdateTotalHits,
  };
};

export const useNavigationFooter = useMessagesNavigationFooter;

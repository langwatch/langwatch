import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import { ChevronLeft, ChevronRight } from "lucide-react"; // Changed from react-feather
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/utils/compat/next-router";
import type { AppRouter } from "../server/api/root";

// Constants
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250] as const;

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
const parseQueryNumber = (
  value: string | string[] | undefined,
  fallback: number,
): number => {
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
 * How a list walks its pages. Declared by the caller rather than inferred from
 * the URL, because inferring it is what broke trace pagination: with the mode
 * read off `!!scrollId`, the first page of a cursor list looked like an offset
 * list, so "next" from page one wrote a `pageOffset` the trace API does not
 * read and silently re-served page one (#6808).
 *
 * - `cursor` — keyset paging via `scrollId`. Trace search: offset paging was
 *   dropped in the ClickHouse migration and a non-zero `pageOffset` is now
 *   rejected at the boundary.
 * - `offset` — real `pageOffset` paging, honoured by the server. The
 *   experiments list and the audit log page this way against Prisma `skip`.
 */
export type PaginationMode = "cursor" | "offset";

/**
 * Custom hook for managing navigation footer state and logic.
 *
 * @param mode - see {@link PaginationMode}. Defaults to `offset`, which is the
 *   behaviour every caller had before the mode existed.
 */
export const useMessagesNavigationFooter = (
  mode: PaginationMode = "offset",
) => {
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

  const urlScrollId = isCursorMode
    ? (router.query.scrollId as string | null)
    : null;

  const cursorInfo = useMemo(() => decodeCursor(urlScrollId), [urlScrollId]);
  const estimatedTotalPages = Math.ceil(
    totalHits / (cursorInfo?.pageSize || pageSize),
  );

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
    (overrides: {
      pageOffset?: number;
      pageSize?: number;
      scrollId?: string | null;
    }) => {
      const {
        pageOffset: _po,
        pageSize: _ps,
        scrollId: _si,
        ...rest
      } = router.query;

      const query: Record<string, string | string[] | undefined> = { ...rest };

      const offset = overrides.pageOffset ?? pageOffset;
      const size = overrides.pageSize ?? pageSize;
      const scroll = overrides.scrollId;

      if (!isCursorMode && offset !== 0) query.pageOffset = offset.toString();
      if (size !== DEFAULT_PAGE_SIZE) query.pageSize = size.toString();
      if (scroll) query.scrollId = scroll;

      return query;
    },
    [router.query, pageOffset, pageSize, isCursorMode],
  );

  /**
   * Navigate to the next page
   * @param currentResponseScrollId - Scroll ID from the current response (for cursor pagination)
   */
  const nextPage = useCallback(
    (currentResponseScrollId?: string | null) => {
      if (currentResponseScrollId) {
        // Push the current scrollId onto the stack before navigating forward
        // so prevPage can pop it to go back.
        if (urlScrollId) {
          cursorStackRef.current.push(urlScrollId);
        }
        setCursorPageNumber((prev) => prev + 1);
        void router.push(
          {
            pathname: router.pathname,
            query: buildPaginationQuery({
              scrollId: currentResponseScrollId,
            }),
          },
          undefined,
          { shallow: true },
        );
        return;
      }

      // In cursor mode, no cursor in the response means there is no next page.
      // The button is disabled in that state, so this is only reachable by a
      // stale click — and advancing an offset here is exactly the bug: the
      // trace API would return page one again, silently.
      if (isCursorMode) return;

      void router.push(
        {
          pathname: router.pathname,
          query: buildPaginationQuery({
            pageOffset: pageOffset + pageSize,
          }),
        },
        undefined,
        { shallow: true },
      );
    },
    [
      router,
      pageOffset,
      pageSize,
      isCursorMode,
      urlScrollId,
      buildPaginationQuery,
    ],
  );

  /**
   * Navigate to the previous page
   */
  const prevPage = useCallback(() => {
    if (isCursorMode) {
      const stack = cursorStackRef.current;
      if (stack.length > 0) {
        // Pop the cursor this scroll came from and navigate back to it.
        const previousScrollId = stack.pop()!;
        setCursorPageNumber((prev) => Math.max(1, prev - 1));
        void router.push(
          {
            pathname: router.pathname,
            query: buildPaginationQuery({ scrollId: previousScrollId }),
          },
          undefined,
          { shallow: true },
        );
        return;
      }

      // Nothing walked yet — drop the cursor and land on the first page. Keyset
      // pagination has no way back other than replaying from the start.
      setCursorPageNumber(1);
      void router.push(
        {
          pathname: router.pathname,
          query: buildPaginationQuery({ scrollId: null }),
        },
        undefined,
        { shallow: true },
      );
      return;
    }

    if (pageOffset > 0) {
      void router.push(
        {
          pathname: router.pathname,
          query: buildPaginationQuery({
            pageOffset: Math.max(0, pageOffset - pageSize),
          }),
        },
        undefined,
        { shallow: true },
      );
    }
  }, [router, pageOffset, pageSize, isCursorMode, buildPaginationQuery]);

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
            scrollId: null,
          }),
        },
        undefined,
        { shallow: true },
      );
    },
    [router, buildPaginationQuery],
  );

  /**
   * Hook to update total hits from TRPC query result
   * @param traceGroups - TRPC query result
   */
  const useUpdateTotalHits = <T extends { totalHits?: number }>(
    queryResult: UseTRPCQueryResult<T, TRPCClientErrorLike<AppRouter>>,
  ) => {
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
          scrollId: null,
        }),
      },
      undefined,
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
    useUpdateTotalHits,
  };
};

/**
 * Footer component for messages navigation with pagination controls
 */
export function MessagesNavigationFooter({
  mode = "offset",
  totalHits,
  pageOffset = 0,
  pageSize,
  isPastFirstPage = false,
  cursorInfo = null,
  cursorPageNumber = 1,
  estimatedTotalPages = 1,
  nextPage,
  prevPage,
  changePageSize,
  scrollId,
}: {
  /** See {@link PaginationMode}. Decides which controls mean anything here. */
  mode?: PaginationMode;
  totalHits: number;
  pageOffset?: number;
  pageSize: number;
  /**
   * True once a cursor list has walked past its first page. Offset lists leave
   * it false and are described by `pageOffset` alone.
   */
  isPastFirstPage?: boolean;
  cursorInfo?: CursorInfo | null;
  cursorPageNumber?: number;
  estimatedTotalPages?: number;
  nextPage: (currentResponseScrollId?: string | null) => void;
  prevPage: () => void;
  changePageSize: (size: number) => void;
  /**
   * Cursor for the NEXT page, from the current response. Present only for
   * cursor lists, where its absence is how "nothing follows this" is said.
   */
  scrollId?: string | null;
}) {
  if (totalHits === 0 && pageOffset === 0 && !isPastFirstPage) return null;

  const isCursorMode = mode === "cursor";

  const isPrevDisabled = isCursorMode
    ? cursorPageNumber <= 1
    : pageOffset === 0;
  // A cursor list is out of pages when the response carried no cursor — which
  // is also true on its first page, so this cannot be keyed on having walked
  // past page one. An offset list is out when the window reaches the total.
  const isNextDisabled = isCursorMode
    ? !scrollId
    : pageOffset + pageSize >= totalHits;

  return (
    <HStack padding={6} gap={2}>
      <Field.Root>
        <HStack gap={3}>
          <Field.Label flexShrink={0}>Items per page</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={pageSize.toString()}
              onChange={(e) => changePageSize(parseInt(e.target.value, 10))}
              borderColor="black"
              borderRadius="lg"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size.toString()}>
                  {size}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      </Field.Root>

      <HStack gap={3} paddingRight={3}>
        <Text flexShrink={0}>
          {isCursorMode && isPastFirstPage
            ? `Page ${cursorPageNumber} of about ${estimatedTotalPages} (${totalHits} total items)`
            : `${pageOffset + 1}-${Math.min(
                pageOffset + pageSize,
                totalHits,
              )} of ${totalHits} items`}
        </Text>
        <HStack gap={0}>
          <Button
            variant="ghost"
            padding={0}
            onClick={prevPage}
            disabled={isPrevDisabled}
            aria-label="Go to previous page"
            title="Go to previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            padding={0}
            disabled={isNextDisabled}
            onClick={() => nextPage(scrollId)}
            aria-label="Go to next page"
            title="Go to next page"
          >
            <ChevronRight />
          </Button>
        </HStack>
      </HStack>
    </HStack>
  );
}

// Backward compatibility exports
export const useNavigationFooter = useMessagesNavigationFooter;
export const NavigationFooter = MessagesNavigationFooter;

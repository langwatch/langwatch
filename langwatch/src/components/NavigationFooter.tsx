import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronLeft, ChevronRight } from "lucide-react"; // Changed from react-feather
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
 * Custom hook for managing messages navigation footer state and logic
 *
 * Handles both cursor-based and offset-based pagination, URL state management,
 * and provides navigation functions.
 */
export const useMessagesNavigationFooter = () => {
  const router = useRouter();

  const [totalHits, setTotalHits] = useState<number>(0);
  const [cursorPageNumber, setCursorPageNumber] = useState<number>(1);

  // Safely parse URL parameters
  const pageOffset = useMemo(
    () => parseQueryNumber(router.query.pageOffset, 0),
    [router.query.pageOffset],
  );

  const pageSize = useMemo(
    () => parseQueryNumber(router.query.pageSize, DEFAULT_PAGE_SIZE),
    [router.query.pageSize],
  );

  const urlScrollId = router.query.scrollId as string | null;
  const useCursorPagination = !!urlScrollId;

  const cursorInfo = useMemo(() => decodeCursor(urlScrollId), [urlScrollId]);
  const estimatedTotalPages = Math.ceil(
    totalHits / (cursorInfo?.pageSize || pageSize),
  );

  // Reset cursor page number when switching pagination modes
  useEffect(() => {
    if (!useCursorPagination) {
      setCursorPageNumber(1);
    }
  }, [useCursorPagination]);

  /**
   * Navigate to the next page
   * @param currentResponseScrollId - Scroll ID from the current response (for cursor pagination)
   */
  const nextPage = useCallback(
    (currentResponseScrollId?: string | null) => {
      if (currentResponseScrollId) {
        // Cursor-based pagination
        setCursorPageNumber((prev) => prev + 1);
        void router.push({
          pathname: router.pathname,
          query: { ...router.query, scrollId: currentResponseScrollId },
        });
      } else if (useCursorPagination) {
        // In cursor mode but no more results
        return;
      } else {
        // Offset-based pagination
        const newOffset = pageOffset + pageSize;
        void router.push({
          pathname: router.pathname,
          query: { ...router.query, pageOffset: newOffset.toString() },
        });
      }
    },
    [router, pageOffset, pageSize, useCursorPagination],
  );

  /**
   * Navigate to the previous page
   */
  const prevPage = useCallback(() => {
    if (useCursorPagination) {
      // Reset to first page in offset mode
      setCursorPageNumber(1);
      void router.push({
        pathname: router.pathname,
        query: { ...router.query, scrollId: undefined, pageOffset: "0" },
      });
    } else if (pageOffset > 0) {
      // Offset-based pagination
      const newOffset = pageOffset - pageSize;
      void router.push({
        pathname: router.pathname,
        query: { ...router.query, pageOffset: newOffset.toString() },
      });
    }
  }, [router, pageOffset, pageSize, useCursorPagination]);

  /**
   * Change the page size and reset pagination
   * @param size - New page size
   */
  const changePageSize = useCallback(
    (size: number) => {
      void router.push({
        pathname: router.pathname,
        query: {
          ...router.query,
          pageSize: size.toString(),
          pageOffset: "0",
          scrollId: undefined,
        },
      });
    },
    [router],
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
  useEffect(() => {
    // Only push if we have the required dynamic route params
    if (!router.query.project) return;

    void router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        pageOffset: "0",
        pageSize: DEFAULT_PAGE_SIZE.toString(),
        scrollId: undefined,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.query]); // Note: This might need adjustment based on your query param name

  return {
    totalHits,
    pageOffset,
    pageSize,
    useCursorPagination,
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
  totalHits,
  pageOffset,
  pageSize,
  useCursorPagination = false,
  cursorInfo = null,
  cursorPageNumber = 1,
  estimatedTotalPages = 1,
  nextPage,
  prevPage,
  changePageSize,
  scrollId,
}: {
  totalHits: number;
  pageOffset: number;
  pageSize: number;
  useCursorPagination?: boolean;
  cursorInfo?: CursorInfo | null;
  cursorPageNumber?: number;
  estimatedTotalPages?: number;
  nextPage: (currentResponseScrollId?: string | null) => void;
  prevPage: () => void;
  changePageSize: (size: number) => void;
  scrollId?: string | null;
}) {
  if (totalHits === 0 && pageOffset === 0 && !useCursorPagination) return null;

  const isPrevDisabled = !useCursorPagination && pageOffset === 0;
  const isNextDisabled = useCursorPagination
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
          {useCursorPagination
            ? `Page ${cursorPageNumber} of ~${estimatedTotalPages} (${totalHits} total items)`
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
            aria-label={
              useCursorPagination ? "Go to first page" : "Go to previous page"
            }
            title={
              useCursorPagination ? "Go to first page" : "Go to previous page"
            }
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

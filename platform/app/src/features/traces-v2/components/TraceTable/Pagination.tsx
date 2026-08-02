import { Button, Flex, IconButton, Skeleton, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import type { PageCursor } from "../../stores/filterStore";
import { useFilterStore } from "../../stores/filterStore";
import { useTraceTableScrollElement } from "./scrollContext";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

interface PaginationProps {
  totalHits: number;
  /** Cursor returned by the current batch; null means the end. */
  nextCursor?: PageCursor | null;
  visibleCount?: number;
  /** What one row is, for the totals copy: "traces" (default) or "sessions". */
  itemNoun?: string;
  /**
   * Renders a placeholder bar in place of the rows-per-page selector +
   * "Page X of Y" copy while data is loading, so the pagination row
   * doesn't pop in when the first page resolves. Back/forward arrows
   * keep rendering — their disabled state doesn't change between
   * loading and loaded for the initial page, and they anchor the
   * visual end of the row.
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
  const setPage = useFilterStore((s) => s.setPage);
  const setPageCursor = useFilterStore((s) => s.setPageCursor);
  const setPageSize = useFilterStore((s) => s.setPageSize);
  const scrollElement = useTraceTableScrollElement();

  // The size the data source actually pages by, which is what the range
  // copy must count by when the shared preference exceeds the lens's cap.
  const effectivePageSize =
    maxPageSize !== undefined ? Math.min(pageSize, maxPageSize) : pageSize;
  const sizeOptions =
    maxPageSize !== undefined
      ? PAGE_SIZE_OPTIONS.filter((size) => size <= maxPageSize)
      : PAGE_SIZE_OPTIONS;

  const safePage = Math.max(page, 1);
  const rangeStart = (safePage - 1) * effectivePageSize + 1;
  const rangeEnd = rangeStart + Math.max(visibleCount - 1, 0);
  // A background refresh of the CURRENT page must not lock navigation. On a
  // busy live project SSE can keep `isFetching` true almost continuously;
  // disabling Next for that signal made pagination appear broken. Only a key
  // transition (React Query is showing previous-page data) is a page lock.
  const busy = isLoading || isTransitioning;

  const goToPrevious = () => {
    if (busy) return;
    setPage(Math.max(safePage - 1, 1));
    scrollElement?.scrollTo({ top: 0, behavior: "auto" });
  };

  const goToNext = () => {
    if (busy || !nextCursor) return;
    setPageCursor(safePage + 1, nextCursor);
    setPage(safePage + 1);
    scrollElement?.scrollTo({ top: 0, behavior: "auto" });
  };

  if (!isLoading && totalHits === 0) return null;

  return (
    <Flex
      align="center"
      justify="flex-end"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
      bg="bg.surface"
      flexShrink={0}
    >
      {isLoading ? (
        <Skeleton height="14px" width="240px" borderRadius="sm" />
      ) : (
        <>
          <Flex align="center" gap={0.5}>
            <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
              Rows
            </Text>
            {sizeOptions.map((size) => (
              <Button
                key={size}
                variant="ghost"
                size="2xs"
                color={effectivePageSize === size ? "fg" : "fg.subtle"}
                fontWeight={effectivePageSize === size ? "semibold" : "normal"}
                onClick={() => setPageSize(size)}
                paddingX={1.5}
                minWidth="auto"
              >
                {size}
              </Button>
            ))}
          </Flex>
          <Text textStyle="xs" color="fg.subtle">
            {totalHits.toLocaleString()} {itemNoun} · showing {rangeStart}–
            {rangeEnd}
          </Text>
        </>
      )}
      <Flex gap={1}>
        <IconButton
          aria-label="Previous page"
          variant="ghost"
          size="xs"
          disabled={busy || safePage <= 1}
          onClick={goToPrevious}
        >
          <ChevronLeft size={12} />
        </IconButton>
        <IconButton
          aria-label="Next page"
          variant="ghost"
          size="xs"
          disabled={busy || !nextCursor}
          onClick={goToNext}
        >
          <ChevronRight size={12} />
        </IconButton>
      </Flex>
    </Flex>
  );
};

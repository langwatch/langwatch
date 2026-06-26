import { Button, Flex, IconButton, Skeleton, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "react-feather";

/**
 * Prop-driven classic "page N of M" pager, modeled on the traces-v2 table pager
 * (rows-per-page selector + page indicator + prev/next, a loading skeleton, and
 * hidden when there is nothing to page). Unlike that one it takes its state as
 * props instead of reading a feature store, so any surface can own its own page
 * state and data source.
 *
 * The page count is derived from `totalCount / pageSize` — the single source of
 * truth — so it stays correct the instant `pageSize` changes, before any refetch.
 */

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  isLoading = false,
  /**
   * Extra disable for the prev/next arrows beyond loading + boundaries — e.g. an
   * editor that blocks navigation while a record save is still in flight.
   */
  navDisabled = false,
  /** Plural noun shown after the total, e.g. "records". Omit to hide the total. */
  unitLabel,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  isLoading?: boolean;
  navDisabled?: boolean;
  unitLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  // Nothing to page through once the count is known to be zero.
  if (!isLoading && totalCount === 0) return null;

  return (
    <Flex
      align="center"
      justify="flex-end"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
      data-testid="pagination"
    >
      {isLoading ? (
        <Skeleton height="14px" width="200px" borderRadius="sm" />
      ) : (
        <>
          {onPageSizeChange && (
            <Flex align="center" gap={0.5}>
              <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
                Rows
              </Text>
              {pageSizeOptions.map((size) => (
                <Button
                  key={size}
                  variant="ghost"
                  size="2xs"
                  color={pageSize === size ? "fg" : "fg.subtle"}
                  fontWeight={pageSize === size ? "semibold" : "normal"}
                  onClick={() => onPageSizeChange(size)}
                  paddingX={1.5}
                  minWidth="auto"
                  data-testid={`pagination-size-${size}`}
                >
                  {size}
                </Button>
              ))}
            </Flex>
          )}
          <Text
            textStyle="xs"
            color="fg.subtle"
            data-testid="pagination-indicator"
          >
            Page {currentPage} of {totalPages}
            {unitLabel ? ` (${totalCount.toLocaleString()} ${unitLabel})` : ""}
          </Text>
        </>
      )}
      <Flex gap={1}>
        <IconButton
          aria-label="Previous page"
          variant="ghost"
          size="xs"
          disabled={isLoading || navDisabled || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          data-testid="pagination-prev"
        >
          <ChevronLeft size={14} />
        </IconButton>
        <IconButton
          aria-label="Next page"
          variant="ghost"
          size="xs"
          disabled={isLoading || navDisabled || currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          data-testid="pagination-next"
        >
          <ChevronRight size={14} />
        </IconButton>
      </Flex>
    </Flex>
  );
}

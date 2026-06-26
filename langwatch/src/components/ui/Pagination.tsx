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

type PaginationProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  isLoading?: boolean;
  /**
   * Extra disable for the controls beyond loading + boundaries — e.g. an editor
   * that blocks navigation (and a page-size change, which also resets the page)
   * while a record save is still in flight.
   */
  navDisabled?: boolean;
  /** Plural noun shown after the total, e.g. "records". Omit to hide the total. */
  unitLabel?: string;
};

function PageSizeSelector({
  pageSize,
  pageSizeOptions,
  disabled,
  onPageSizeChange,
}: {
  pageSize: number;
  pageSizeOptions: readonly number[];
  disabled: boolean;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <Flex align="center" gap={0.5}>
      <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
        Rows
      </Text>
      {pageSizeOptions.map((size) => {
        const active = pageSize === size;
        return (
          <Button
            key={size}
            variant="ghost"
            size="2xs"
            // Same nav gate as prev/next: a size change clears selection, resets
            // to page 1, and refetches, so it must not run while a save is in
            // flight. The already-active size is a no-op.
            disabled={disabled || active}
            color={active ? "fg" : "fg.subtle"}
            fontWeight={active ? "semibold" : "normal"}
            onClick={() => onPageSizeChange(size)}
            paddingX={1.5}
            minWidth="auto"
            data-testid={`pagination-size-${size}`}
          >
            {size}
          </Button>
        );
      })}
    </Flex>
  );
}

function PageNav({
  currentPage,
  totalPages,
  disabled,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <Flex gap={1}>
      <IconButton
        aria-label="Previous page"
        variant="ghost"
        size="xs"
        disabled={disabled || currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        data-testid="pagination-prev"
      >
        <ChevronLeft size={14} />
      </IconButton>
      <IconButton
        aria-label="Next page"
        variant="ghost"
        size="xs"
        disabled={disabled || currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        data-testid="pagination-next"
      >
        <ChevronRight size={14} />
      </IconButton>
    </Flex>
  );
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  isLoading = false,
  navDisabled = false,
  unitLabel,
}: PaginationProps) {
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
            <PageSizeSelector
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              disabled={navDisabled}
              onPageSizeChange={onPageSizeChange}
            />
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
      <PageNav
        currentPage={currentPage}
        totalPages={totalPages}
        disabled={isLoading || navDisabled}
        onPageChange={onPageChange}
      />
    </Flex>
  );
}

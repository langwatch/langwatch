import {
  Button,
  Pagination as ChakraPagination,
  Grid,
  HStack,
  NativeSelect,
  Skeleton,
  Text,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Prop-driven pagination bar: a plain-language description of the page on the
 * left, a numbered pager in the middle, and a deliberately empty right column
 * (the assistant's floating button lives in that corner and used to cover the
 * navigation).
 *
 * The page count is derived from `totalCount / pageSize`, the single source of
 * truth, so it stays correct the instant `pageSize` changes, before any
 * refetch. Cursor-only data sources, which cannot open an arbitrary page, say
 * so through `isPageReachable` and `canGoNext` rather than through a different
 * component.
 */

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  isLoading?: boolean;
  /**
   * Extra disable for the controls beyond loading + boundaries, e.g. an editor
   * that blocks navigation (and a page-size change, which also resets the page)
   * while a record save is still in flight.
   */
  navDisabled?: boolean;
  /** Plural noun shown after the total, e.g. "records". Omit to hide the total. */
  unitLabel?: string;
  /**
   * Rows actually rendered on this page. Given, the range copy ends where the
   * data ends rather than where a full page would; omitted, a full page is
   * assumed and the range is capped by the total.
   */
  visibleCount?: number;
  /**
   * Whether a page number can be opened at all. A cursor-only data source can
   * reach the pages it has already walked and the one after the current batch,
   * and nothing else. Defaults to every page being reachable.
   */
  isPageReachable?: (page: number) => boolean;
  /**
   * Extra gate on Next for data sources that know about a following page from
   * something other than the total: a cursor. Next still needs a page to move
   * to, so this narrows the last-page check rather than replacing it.
   */
  canGoNext?: boolean;
}

function PageSizeField({
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
    <NativeSelect.Root
      size="xs"
      width="auto"
      flexShrink={0}
      disabled={disabled}
    >
      <NativeSelect.Field
        aria-label="Rows per page"
        data-testid="pagination-page-size"
        value={String(pageSize)}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        height={6}
        paddingInlineStart={1.5}
        paddingInlineEnd={5}
      >
        {pageSizeOptions.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

function PageSummary({
  totalCount,
  unitLabel,
  rangeStart,
  rangeEnd,
  pageSize,
  pageSizeOptions,
  disabled,
  onPageSizeChange,
}: {
  totalCount: number;
  unitLabel?: string;
  rangeStart: number;
  rangeEnd: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  disabled: boolean;
  onPageSizeChange?: (size: number) => void;
}) {
  const segments = unitLabel
    ? [`${totalCount.toLocaleString()} ${unitLabel}`]
    : [];
  segments.push(`showing ${rangeStart}–${rangeEnd}`);
  if (onPageSizeChange) segments.push("per page");

  return (
    <HStack gap={1.5} justifySelf="start" data-testid="pagination-indicator">
      <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
        {segments.join(" · ")}
      </Text>
      {onPageSizeChange && (
        <PageSizeField
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          disabled={disabled}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </HStack>
  );
}

function PageNumberButton({
  value,
  isCurrent,
  disabled,
}: {
  value: number;
  isCurrent: boolean;
  disabled: boolean;
}) {
  return (
    <ChakraPagination.Item type="page" value={value} asChild>
      <Button
        variant={isCurrent ? "subtle" : "ghost"}
        size="xs"
        color={isCurrent ? "fg" : "fg.subtle"}
        fontWeight={isCurrent ? "semibold" : "normal"}
        disabled={disabled}
        paddingX={1.5}
        minWidth={6}
        data-testid={`pagination-page-${value}`}
      >
        {value}
      </Button>
    </ChakraPagination.Item>
  );
}

function PageNavigator({
  page,
  pageSize,
  totalCount,
  totalPages,
  disabled,
  canGoNext,
  isPageReachable,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  disabled: boolean;
  canGoNext: boolean;
  isPageReachable: (page: number) => boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <ChakraPagination.Root
      count={totalCount}
      pageSize={pageSize}
      page={page}
      siblingCount={2}
      onPageChange={(details) => onPageChange(details.page)}
    >
      <HStack gap={0.5}>
        <ChakraPagination.PrevTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            color="fg.subtle"
            paddingX={1.5}
            disabled={disabled || page <= 1}
            data-testid="pagination-prev"
          >
            <ChevronLeft size={14} />
            Back
          </Button>
        </ChakraPagination.PrevTrigger>
        <ChakraPagination.Context>
          {({ pages }) =>
            pages.map((entry, index) =>
              entry.type === "ellipsis" ? (
                <ChakraPagination.Ellipsis
                  // Ellipsis entries carry no value of their own; their
                  // position in the range is the only thing that identifies
                  // them.
                  key={`ellipsis-${index}`}
                  index={index}
                  textStyle="xs"
                  color="fg.subtle"
                  paddingX={1}
                >
                  {"…"}
                </ChakraPagination.Ellipsis>
              ) : (
                <PageNumberButton
                  key={entry.value}
                  value={entry.value}
                  isCurrent={entry.value === page}
                  disabled={disabled || !isPageReachable(entry.value)}
                />
              ),
            )
          }
        </ChakraPagination.Context>
        <ChakraPagination.NextTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            color="fg.subtle"
            paddingX={1.5}
            disabled={disabled || !canGoNext || page >= totalPages}
            data-testid="pagination-next"
          >
            Next
            <ChevronRight size={14} />
          </Button>
        </ChakraPagination.NextTrigger>
      </HStack>
    </ChakraPagination.Root>
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
  visibleCount,
  isPageReachable,
  canGoNext = true,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = (currentPage - 1) * pageSize + 1;
  const rangeEnd =
    visibleCount === undefined
      ? Math.min(currentPage * pageSize, totalCount)
      : rangeStart + Math.max(visibleCount - 1, 0);
  // Nothing to page through once the count is known to be zero.
  if (!isLoading && totalCount === 0) return null;

  return (
    <Grid
      templateColumns="1fr auto 1fr"
      alignItems="center"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
      bg="bg.surface"
      flexShrink={0}
      data-testid="pagination"
    >
      {isLoading ? (
        <Skeleton
          height="14px"
          width="240px"
          borderRadius="sm"
          data-testid="pagination-placeholder"
        />
      ) : (
        <PageSummary
          totalCount={totalCount}
          unitLabel={unitLabel}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          disabled={navDisabled}
          onPageSizeChange={onPageSizeChange}
        />
      )}
      <PageNavigator
        page={currentPage}
        pageSize={pageSize}
        totalCount={totalCount}
        totalPages={totalPages}
        disabled={isLoading || navDisabled}
        canGoNext={canGoNext}
        isPageReachable={isPageReachable ?? (() => true)}
        onPageChange={onPageChange}
      />
    </Grid>
  );
}

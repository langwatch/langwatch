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

/** Pagination bar: description left, pager middle, empty right. Supports cursor-only sources. */

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface PaginationCommon {
  page: number;
  pageSize: number;
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
   * Rows actually rendered on this page. Given, the range copy ends where
   * the data ends; omitted or zero, a full page is assumed, capped by total.
   */
  visibleCount?: number;
  /** `center` puts the navigation in the middle, the summary yielding first. Default "end". */
  layout?: "end" | "center";
  /** `card` paints the bar on the card ground. Default "transparent". */
  ground?: "transparent" | "card";
  /** `subtle` keeps the quieter summary colour of the trace table. Default "muted". */
  summaryTone?: "muted" | "subtle";
}

const NARROW = "@media (max-width: 30rem)";

function barLook({
  layout = "end",
  ground = "transparent",
}: Pick<PaginationCommon, "layout" | "ground">) {
  const center = layout === "center";
  return {
    templateColumns: center
      ? "minmax(max-content, 1fr) auto minmax(0, 1fr)"
      : { base: "minmax(0, 1fr)", md: "1fr auto" },
    ...(ground === "card" ? { background: "bg.card" } : {}),
    ...(center ? { [NARROW]: { templateColumns: "minmax(0, 1fr)", justifyItems: "center" } } : {}),
  } as const;
}

/** A source that knows its total: numbered pages, the count and the range. */
export interface KnownTotalPaginationProps extends PaginationCommon {
  totalCount: number;
  /** Replaces only the "<total> <unitLabel>" part of the summary; empty keeps the default. */
  totalSummary?: string;
  hasMore?: never;
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

/**
 * A source that cannot count: Back, "Page N" and Next, enabled while the source says there is
 * more. No total, no numbered jumps; the range shows only when `visibleCount` is given.
 */
export interface OpenEndedPaginationProps extends PaginationCommon {
  totalCount?: never;
  hasMore: boolean;
  isPageReachable?: never;
  canGoNext?: never;
}

export type PaginationProps = KnownTotalPaginationProps | OpenEndedPaginationProps;

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
    <NativeSelect.Root size="xs" width="auto" flexShrink={0} disabled={disabled}>
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
  totalSummary,
  tone = "muted",
  rangeStart,
  rangeEnd,
  pageSize,
  pageSizeOptions,
  disabled,
  onPageSizeChange,
}: {
  totalCount: number;
  unitLabel?: string;
  totalSummary?: string;
  tone?: "muted" | "subtle";
  rangeStart: number;
  rangeEnd: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  disabled: boolean;
  onPageSizeChange?: (size: number) => void;
}) {
  const counted = unitLabel ? `${totalCount.toLocaleString()} ${unitLabel}` : null;
  const total = totalSummary || counted;
  const segments = total ? [total] : [];
  segments.push(`showing ${rangeStart}–${rangeEnd}`);
  if (onPageSizeChange) segments.push("per page");

  return (
    <HStack
      gap={1.5}
      rowGap={1}
      flexWrap="wrap"
      justifySelf="start"
      minWidth={0}
      data-testid="pagination-indicator"
    >
      <Text textStyle="xs" color={tone === "subtle" ? "fg.subtle" : "fg.muted"} flexShrink={0}>
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
      <HStack gap={0.5} flexWrap="wrap" justifyContent={{ base: "start", md: "end" }}>
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

/** A known total pages by number; an open-ended source steps with Back and Next. */
export function Pagination(props: PaginationProps) {
  if (props.totalCount === void 0) return <OpenEndedPagination {...props} />;
  return <KnownTotalPagination {...props} />;
}

function KnownTotalPagination({
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
  totalSummary,
  layout,
  ground,
  summaryTone,
}: KnownTotalPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = (currentPage - 1) * pageSize + 1;
  const rangeEnd =
    visibleCount === undefined || visibleCount === 0
      ? Math.min(currentPage * pageSize, totalCount)
      : rangeStart + visibleCount - 1;
  // Nothing to page through once the count is known to be zero.
  if (!isLoading && totalCount === 0) return null;

  return (
    // The count on the left, the pages on the right, on whatever ground the list sits on.
    // A phone stacks the count above the pages, so neither runs into the other.
    <Grid
      {...barLook({ layout, ground })}
      alignItems="center"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
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
          totalSummary={totalSummary}
          tone={summaryTone}
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

function OpenEndedPagination({
  page,
  pageSize,
  hasMore,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  isLoading = false,
  navDisabled = false,
  visibleCount,
  layout,
  ground,
  summaryTone,
}: OpenEndedPaginationProps) {
  const currentPage = Math.max(1, page);
  const rangeStart = (currentPage - 1) * pageSize + 1;
  const disabled = isLoading || navDisabled;
  if (!isLoading && currentPage === 1 && visibleCount === 0 && !hasMore) return null;

  return (
    <Grid
      {...barLook({ layout, ground })}
      alignItems="center"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
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
        <HStack gap={1.5} justifySelf="start" data-testid="pagination-indicator">
          {visibleCount !== void 0 && visibleCount > 0 && (
            <Text
              textStyle="xs"
              color={summaryTone === "subtle" ? "fg.subtle" : "fg.muted"}
              flexShrink={0}
            >
              {`showing ${rangeStart}–${rangeStart + visibleCount - 1}`}
              {onPageSizeChange ? " · per page" : ""}
            </Text>
          )}
          {onPageSizeChange && (
            <PageSizeField
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              disabled={navDisabled}
              onPageSizeChange={onPageSizeChange}
            />
          )}
        </HStack>
      )}
      <HStack gap={0.5}>
        <Button
          variant="ghost"
          size="xs"
          color="fg.subtle"
          paddingX={1.5}
          disabled={disabled || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          data-testid="pagination-prev"
        >
          <ChevronLeft size={14} />
          Back
        </Button>
        <Text
          textStyle="xs"
          color="fg"
          fontWeight="semibold"
          paddingX={1.5}
          aria-current="page"
          data-testid="pagination-current"
        >
          Page {currentPage}
        </Text>
        <Button
          variant="ghost"
          size="xs"
          color="fg.subtle"
          paddingX={1.5}
          disabled={disabled || !hasMore}
          onClick={() => onPageChange(currentPage + 1)}
          data-testid="pagination-next"
        >
          Next
          <ChevronRight size={14} />
        </Button>
      </HStack>
    </Grid>
  );
}

export { Pagination as RawPagination } from "@chakra-ui/react";

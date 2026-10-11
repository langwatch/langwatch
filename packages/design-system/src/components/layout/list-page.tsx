import { Alert, Box, HStack, Skeleton, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { SearchInput } from "../forms/search-input.tsx";
import { Banner, BannerAction } from "../states/banner.tsx";
import { NoDataInfoBlock, type NoDataInfoBlockProps } from "../states/no-data-info-block.tsx";
import { BackLink } from "./back-link.tsx";
import { LoadMore, type LoadMoreProps } from "./load-more.tsx";
import { PageLayout } from "./page-layout.tsx";
import { Pagination, type PaginationProps } from "./pagination.tsx";
import { SelectionActionBar, type SelectionActionBarProps } from "./selection-action-bar.tsx";

/** What the list shows. The caller derives it from its read; the page never guesses. */
export type ListPageState = "loading" | "error" | "empty" | "no-results" | "ready";

export interface ListPageSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The search box's accessible name. */
  ariaLabel: string;
  testId?: string;
}

/** A way back to the list this page hangs under; a plain click routes through `onNavigate`. */
export interface ListPageBack {
  label: string;
  href: string;
  onNavigate: (href: string) => void;
}

export interface ListPageErrorConfig {
  title: string;
  description?: string;
  onRetry?: () => void;
}

/** Filters matched nothing, though records exist. */
export interface ListPageNoResults {
  description: string;
  onClear?: () => void;
}

/** Offset or cursor tables page; append feeds load more. Never both. */
type ListPagePaging =
  | { pagination?: PaginationProps; loadMore?: never }
  | { loadMore?: LoadMoreProps; pagination?: never };

/**
 * `error` and `empty` show their block alone; `loading` disables search; `no-results` keeps
 * the toolbar so it can be cleared; only `ready` pages, loads more or selects. An `error`
 * with `ready` is an inline notice over the retained rows. Spec: specs/list-page.feature.
 */
export type ListPageProps = ListPagePaging & {
  title: string;
  /** First body line, muted. */
  description?: string;
  back?: ListPageBack;
  /** `PageLayout.HeaderButton`s only; one `primary`. */
  actions?: ReactNode;
  state: ListPageState;
  search?: ListPageSearch;
  /** FilterChips, a scope picker, a segmented control. */
  filters?: ReactNode;
  refreshing?: boolean;
  error?: ListPageErrorConfig;
  empty?: NoDataInfoBlockProps;
  noResults?: ListPageNoResults;
  selection?: SelectionActionBarProps;
  /** A ListTable, or a CardGrid of ResourceTiles. */
  children: ReactNode;
};

/** @deprecated Pass `state`, `description`, `search`, `filters`, `error` and `empty` configs. */
export interface LegacyListPageProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  error?: ReactNode;
  empty?: ReactNode;
  pagination?: PaginationProps;
  children: ReactNode;
}

const MISSING_EMPTY: NoDataInfoBlockProps = { size: "line", title: "Nothing here yet." };
const MISSING_NO_RESULTS: ListPageNoResults = { description: "No results match." };
const MISSING_ERROR: ListPageErrorConfig = { title: "This list could not be loaded." };

/** A controlled resource list: the caller owns data, filtering, and the table's columns. */
/** @deprecated Pass the `state` shape. Listed first so only a call without `state` lands here. */
export function ListPage(props: LegacyListPageProps): ReactNode;
export function ListPage(props: ListPageProps): ReactNode;
export function ListPage(props: ListPageProps | LegacyListPageProps): ReactNode {
  if ("state" in props) return <ListPageView {...props} />;
  return <LegacyListPage {...props} />;
}

function ListPageView({
  title,
  description,
  back,
  actions,
  state,
  search,
  filters,
  refreshing = false,
  error,
  empty,
  noResults,
  selection,
  pagination,
  loadMore,
  children,
}: ListPageProps) {
  const ready = state === "ready";
  const showToolbar = (search || filters) && state !== "error" && state !== "empty";
  return (
    <>
      <PageLayout.Header actions={actions}>
        {back && (
          <BackLink href={back.href} onNavigate={back.onNavigate}>
            {back.label}
          </BackLink>
        )}
        <PageLayout.Heading>{title}</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full">
        <Stack
          gap={4}
          minWidth={0}
          aria-busy={state === "loading" || (ready && refreshing)}
          data-state={state}
        >
          {description && (
            <Text textStyle="sm" color="fg.muted">
              {description}
            </Text>
          )}
          {showToolbar && (
            <HStack wrap="wrap" gap={3} minWidth={0}>
              {search && (
                <SearchInput
                  value={search.value}
                  onChange={(event) => search.onChange(event.target.value)}
                  placeholder={search.placeholder}
                  aria-label={search.ariaLabel}
                  data-testid={search.testId}
                  disabled={state === "loading"}
                  containerProps={{ flex: "1 1 12rem", maxWidth: "20rem" }}
                />
              )}
              {filters}
            </HStack>
          )}
          {ready && refreshing && (
            <Text as="output" textStyle="xs" color="fg.muted">
              Refreshing…
            </Text>
          )}
          {ready && error && <ListPageErrorBanner {...error} />}
          {state === "loading" && <ListPageSkeleton />}
          {state === "error" && <ListPageErrorBanner {...(error ?? MISSING_ERROR)} />}
          {state === "empty" && <NoDataInfoBlock {...(empty ?? MISSING_EMPTY)} />}
          {state === "no-results" && (
            <ListPageNoResultsLine {...(noResults ?? MISSING_NO_RESULTS)} />
          )}
          {ready && (
            <>
              <Box minWidth="0" overflowX="auto">
                {children}
              </Box>
              {pagination && <Pagination {...pagination} />}
              {loadMore && <LoadMore {...loadMore} />}
            </>
          )}
        </Stack>
      </PageLayout.Container>
      {ready && selection && <SelectionActionBar {...selection} />}
    </>
  );
}

function ListPageErrorBanner({ title, description, onRetry }: ListPageErrorConfig) {
  return (
    <Banner
      status="error"
      title={title}
      action={onRetry && <BannerAction onClick={onRetry}>Try again</BannerAction>}
    >
      {description}
    </Banner>
  );
}

function ListPageNoResultsLine({ description, onClear }: ListPageNoResults) {
  return (
    <NoDataInfoBlock
      size="line"
      title={description}
      action={onClear && { label: "Clear filters", onClick: onClear }}
    />
  );
}

function LegacyListPage({
  title,
  subtitle,
  actions,
  toolbar,
  loading,
  refreshing,
  error,
  empty,
  pagination,
  children,
}: LegacyListPageProps) {
  let content = (
    <>
      <Box minWidth="0" overflowX="auto">
        {empty ?? children}
      </Box>
      {!empty && pagination && <Pagination {...pagination} />}
    </>
  );
  if (error) content = <>{error}</>;
  else if (loading) content = <ListPageSkeleton />;

  return (
    <>
      <PageLayout.Header actions={actions}>
        <Stack gap={1} minWidth={0}>
          <PageLayout.Heading>{title}</PageLayout.Heading>
          {subtitle && <PageLayout.Subtitle>{subtitle}</PageLayout.Subtitle>}
        </Stack>
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full">
        <Stack gap={4} minWidth={0}>
          {toolbar && <Box minWidth={0}>{toolbar}</Box>}
          {refreshing && !loading && (
            <Text as="output" textStyle="xs" color="fg.muted">
              Refreshing…
            </Text>
          )}
          {content}
        </Stack>
      </PageLayout.Container>
    </>
  );
}

export function ListPageSkeleton({ label = "Loading records" }: { label?: string }) {
  return (
    <Stack gap={3} padding={4} aria-label={label} aria-busy="true">
      {Array.from({ length: 5 }, (_, row) => (
        <Skeleton key={row} height={8} />
      ))}
    </Stack>
  );
}

/** @deprecated Pass `error: { title, description, onRetry }` with `state="error"`. */
export function ListPageError({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {children && <Alert.Description>{children}</Alert.Description>}
      </Alert.Content>
    </Alert.Root>
  );
}

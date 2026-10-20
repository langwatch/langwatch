import { Alert, Box, HStack, Skeleton, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Banner, BannerAction } from "../states/banner.tsx";
import {
  EmptyNextSteps,
  type EmptyNext,
  type EmptyStateProps,
  NoDataInfoBlock,
} from "../states/no-data-info-block.tsx";
import { BackLink } from "./back-link.tsx";
import { LoadMore, type LoadMoreProps } from "./load-more.tsx";
import { PageLayout } from "./page-layout.tsx";
import { Pagination, type PaginationProps } from "./pagination.tsx";
import { SelectionActionBar, type SelectionActionBarProps } from "./selection-action-bar.tsx";
import { TableToolbar, type TableToolbarProps } from "./table-toolbar.tsx";

export type { ListPageSearch } from "./table-toolbar.tsx";

/** What the list shows. The caller derives it from its read; the page never guesses. */
export type ListPageState = "loading" | "error" | "empty" | "no-results" | "ready";

/** A way back to the list this page hangs under; a plain click routes through `onNavigate`. */
export interface ListPageBack {
  label: string;
  href: string;
  onNavigate: (href: string) => void;
}

export interface ListPageErrorConfig {
  title: string;
  description?: string;
  /** Drawn beside the next step, never instead of it. */
  onRetry?: () => void;
  /** Where to go when retrying does not help: a setting, the docs or an agent prompt. */
  next: EmptyNext;
}

/** Filters matched nothing, though records exist. */
export interface ListPageNoResults {
  description: string;
  /** Drawn beside the next step, never instead of it. */
  onClear?: () => void;
  next: EmptyNext;
}

/** The empty state's block or line, with the next step it must carry. */
export type ListPageEmptyConfig = EmptyStateProps;

/** Each state's config is required with its state; the others are optional. */
type ListPageStateConfig =
  | { state: "loading" | "ready" }
  | { state: "error"; error: ListPageErrorConfig }
  | { state: "empty"; empty: ListPageEmptyConfig }
  | { state: "no-results"; noResults: ListPageNoResults };

/** Offset or cursor tables page; append feeds load more. Never both. */
type ListPagePaging =
  | { pagination?: PaginationProps; loadMore?: never }
  | { loadMore?: LoadMoreProps; pagination?: never };

/**
 * `error` and `empty` show their block alone; `loading` disables search; `no-results` keeps
 * the toolbar so it can be cleared; only `ready` pages, loads more or selects. An `error`
 * with `ready` is an inline notice over the retained rows. Spec: specs/list-page.feature.
 */
export type ListPageProps = ListPagePaging &
  ListPageStateConfig & {
    title: string;
    /** One muted line under the title, in the header. */
    description?: string;
    back?: ListPageBack;
    /** `PageLayout.HeaderButton`s only; one `primary`. */
    actions?: ReactNode;
    /** Search, lookup, filters, columns, summary and actions; the selection stays its own prop. */
    toolbar?: Omit<TableToolbarProps, "disabled" | "attached" | "selection">;
    refreshing?: boolean;
    error?: ListPageErrorConfig;
    empty?: ListPageEmptyConfig;
    noResults?: ListPageNoResults;
    /** `placement="inline"` draws the bar as the first band; floating is the default. */
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
  toolbar,
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
  const inlineSelection = ready && selection?.placement === "inline" ? selection : undefined;
  const floatingSelection = ready && selection?.placement !== "inline" ? selection : undefined;
  const showToolbar = (toolbar || inlineSelection) && state !== "error" && state !== "empty";
  return (
    <>
      <PageLayout.Header actions={actions} description={description}>
        {back && (
          <BackLink href={back.href} onNavigate={back.onNavigate}>
            {back.label}
          </BackLink>
        )}
        <PageLayout.Heading>{title}</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill" {...(description ? { paddingTop: 0 } : {})}>
        <Stack
          gap={4}
          minWidth={0}
          aria-busy={state === "loading" || (ready && refreshing)}
          data-state={state}
        >
          {showToolbar && (
            <TableToolbar {...toolbar} selection={inlineSelection} disabled={state === "loading"} />
          )}
          {ready && refreshing && (
            <Text as="output" textStyle="xs" color="fg.muted">
              Refreshing…
            </Text>
          )}
          {ready && error && <ListPageErrorBanner {...error} />}
          {state === "loading" && <ListPageSkeleton />}
          {state === "error" && <ListPageErrorBanner {...error} />}
          {state === "empty" && <NoDataInfoBlock {...empty} />}
          {state === "no-results" && <ListPageNoResultsLine {...noResults} />}
          {ready && (
            <>
              <Box minWidth="0" maxWidth="100%">
                {children}
              </Box>
              {pagination && <Pagination {...pagination} />}
              {loadMore && <LoadMore {...loadMore} />}
            </>
          )}
        </Stack>
      </PageLayout.Container>
      {floatingSelection && <SelectionActionBar {...floatingSelection} />}
    </>
  );
}

function ListPageErrorBanner({ title, description, onRetry, next }: ListPageErrorConfig) {
  return (
    <Banner
      status="error"
      title={title}
      action={
        <HStack gap={3} wrap="wrap">
          {onRetry && <BannerAction onClick={onRetry}>Try again</BannerAction>}
          <EmptyNextSteps next={next} />
        </HStack>
      }
    >
      {description}
    </Banner>
  );
}

function ListPageNoResultsLine({ description, onClear, next }: ListPageNoResults) {
  return (
    <NoDataInfoBlock
      size="line"
      title={description}
      action={onClear && { label: "Clear filters", onClick: onClear }}
      next={next}
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
      <PageLayout.Header actions={actions} description={subtitle}>
        <PageLayout.Heading>{title}</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill" {...(subtitle ? { paddingTop: 0 } : {})}>
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

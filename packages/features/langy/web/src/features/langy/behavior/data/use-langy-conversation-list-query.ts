import { keepPreviousData } from "@tanstack/react-query";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/langy-api";
import { useLangyStore } from "../../../../index";
import type { LangyConversationListItemDto } from "@langwatch/langy-contract";

/** Bounded page size for the recents combobox's incremental rendering. */
export const LANGY_LIST_PAGE_SIZE = 30;

export function getLangyConversationListInput(
  projectId: string,
  query = "",
): { projectId: string; limit: number; query?: string } {
  const normalizedQuery = query.trim();
  return {
    projectId,
    limit: LANGY_LIST_PAGE_SIZE,
    ...(normalizedQuery ? { query: normalizedQuery } : {}),
  };
}

export interface LangyConversationListQueryResult {
  items: LangyConversationListItemDto[];
  isLoading: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isFetched: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

/**
 * PURE conversation-list query. Reads only the slim spine projection
 * (`langy.list`) — no message content — and never runs side effects. Mirrors
 * `useTraceListQuery`: `keepPreviousData` so a freshness refetch never blanks
 * the recents list, and a `staleTime` so re-opening the panel doesn't refetch
 * on every mount.
 *
 * The side-effect layer (new-arrival marking) lives in `useLangyConversationList`
 * so this hook stays trivially testable and re-composable.
 */
export function useLangyConversationListQuery(queryText = ""): LangyConversationListQueryResult {
  const { project } = useOrganizationTeamProject();
  // The panel stays mounted while closed — never fetch (and so never fail)
  // for a list nobody is looking at. Opening the panel arms the query.
  const isOpen = useLangyStore((s) => s.isOpen);

  const query = api.langy.list.useInfiniteQuery(
    getLangyConversationListInput(project?.id ?? "", queryText),
    {
      enabled: !!project?.id && isOpen,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    // isLoading, not isLoading: React Query v4 reports a DISABLED
    // query as status "loading" forever, and this query is deliberately
    // disabled while the panel is closed — a permanent spinner for a fetch
    // that will never run. isLoading is loading AND actually fetching.
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

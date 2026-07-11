import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyConversationListItemDto } from "./langy.dtos";

/**
 * The hard ceiling on `langy.list` (`z.number().max(100)`), and therefore the
 * hard ceiling on how many conversations any client can ever see. Not a page
 * size — there is no next page.
 */
export const LANGY_LIST_MAX = 100;

export interface LangyConversationListQueryResult {
  items: LangyConversationListItemDto[];
  isLoading: boolean;
  isFetching: boolean;
  isPreviousData: boolean;
  isFetched: boolean;
  isError: boolean;
  error: unknown;
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
export function useLangyConversationListQuery(): LangyConversationListQueryResult {
  const { project } = useOrganizationTeamProject();

  const query = api.langy.list.useQuery(
    // Ask for everything the endpoint will give us. `langy.list` is capped at
    // 100 server-side and has NO cursor, so this is genuinely the whole list a
    // client can obtain — we were silently taking the default 50 and leaving the
    // rest unreachable. It is a slim spine projection (no message content), so
    // the extra rows are close to free, and the recents dropdown's search can
    // then honestly search everything it is able to see.
    //
    // Beyond 100 needs a real server change — see RecentChatsMenu.
    { projectId: project?.id ?? "", limit: LANGY_LIST_MAX },
    {
      enabled: !!project?.id,
      staleTime: 60_000,
      keepPreviousData: true,
    },
  );

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPreviousData: query.isPreviousData,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
  };
}

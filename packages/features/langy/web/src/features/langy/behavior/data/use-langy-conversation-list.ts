import {
  type LangyConversationListQueryResult,
  useLangyConversationListQuery,
} from "./use-langy-conversation-list-query";

/** The panel's recents list — see {@link useLangyConversationListQuery}. */
export type LangyConversationListResult = LangyConversationListQueryResult;

/**
 * The recents list for the panel. A thin, stable entry point onto the pure list query —
 * the panel imports this name, so it stays even though it now only forwards the query.
 */
export function useLangyConversationList(): LangyConversationListResult {
  return useLangyConversationListQuery();
}

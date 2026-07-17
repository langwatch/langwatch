import {
  type LangyConversationListQueryResult,
  useLangyConversationListQuery,
} from "./useLangyConversationListQuery";

/** The panel's recents list — see {@link useLangyConversationListQuery}. */
export type LangyConversationListResult = LangyConversationListQueryResult;

/**
 * The recents list for the panel. A thin, stable entry point onto the pure list
 * query — the panel imports this name, so it stays even though it now only
 * forwards the query. (It once diffed successive result sets to pulse newly
 * arrived conversations; nothing consumed that pulse, so the side effect was
 * removed.)
 */
export function useLangyConversationList(): LangyConversationListResult {
  return useLangyConversationListQuery();
}

import { PANEL_SUGGESTION_COUNT, selectLangySuggestions } from "@langwatch/langy-browser-kit";
import { useMemo } from "react";

import { useProjectReach } from "../../../../behavior/home/use-project-reach.ts";
import type { useLangyConversationList } from "../data/use-langy-conversation-list.ts";

type ConversationItems = ReturnType<typeof useLangyConversationList>["items"];

/**
 * What the recents list already knows about the open conversation: its generated title (null
 * until the subscriber produces one — nothing pretends to be a title meanwhile) and, while it is
 * being restored, how many messages are coming, so the placeholder holds about the right column.
 */
export function useLangyConversationFacts({
  conversations,
  activeConversationId,
  isRestoring,
}: {
  conversations: ConversationItems;
  activeConversationId: string | null;
  isRestoring: boolean;
}) {
  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [conversations, activeConversationId],
  );
  const title = typeof active?.title === "string" ? active.title.trim() : "";
  return {
    title: title.length > 0 ? title : null,
    restoringMessageCount: isRestoring ? (active?.messageCount ?? null) : null,
  };
}

/**
 * The empty state's asks, picked from the project's reach — the same selection the home page runs
 * — and empty until the reach is known: an ask that appears and is withdrawn is worse than none.
 */
export function useLangyEmptySuggestions() {
  const reach = useProjectReach();
  const { isLoading, hasTraces, hasEvaluations, hasExperiments } = reach;
  return useMemo(
    () =>
      isLoading
        ? []
        : selectLangySuggestions({
            reach: { hasTraces, hasEvaluations, hasExperiments },
            count: PANEL_SUGGESTION_COUNT,
          }),
    [isLoading, hasTraces, hasEvaluations, hasExperiments],
  );
}

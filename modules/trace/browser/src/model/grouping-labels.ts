import type { GroupingMode } from "../behavior/view.slice.ts";

/**
 * What the "Group by" picker calls each grouping. Conversations and coding-agent
 * sessions share one grouping key, so a coding-agent scope names it a session.
 */
export function groupingLabels({
  codingAgentScope,
}: {
  codingAgentScope: boolean;
}): Record<GroupingMode, string> {
  return {
    flat: "None",
    "by-conversation": codingAgentScope ? "Session" : "Conversation",
    "by-service": "Service",
    "by-user": "User",
    "by-model": "Model",
  };
}

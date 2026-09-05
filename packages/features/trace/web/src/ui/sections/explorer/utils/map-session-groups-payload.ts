import type { ConversationGroup } from "../trace-table/conversation-groups";
import type { SessionGroupPayloadItem } from "../../../../model/explorer/session-group-payload";
import type { TraceStatus } from "../types/trace";

function worstStatusOf(item: SessionGroupPayloadItem): TraceStatus {
  if (item.errorCount > 0) return "error";
  if (item.warningCount > 0) return "warning";
  return "ok";
}

/**
 * Map a server session row onto the conversation-group view model the lens
 * table renders. `traces` starts empty: turn rows load lazily when the row
 * expands, while every total on the row is already the TRUE rollup.
 */
export function mapSessionGroupToConversationGroup(
  item: SessionGroupPayloadItem,
): ConversationGroup {
  return {
    conversationId: item.conversationId,
    traces: [],
    traceCount: item.traceCount,
    totalDuration: item.totalDurationMs,
    totalCost: item.totalCost,
    totalTokens: item.totalTokens,
    totalSpans: item.totalSpans,
    errorCount: item.errorCount,
    // Event and evaluation rollups are not part of the session read (yet);
    // zero keeps the summary chips honest rather than page-truncated.
    totalEvents: 0,
    totalEvals: 0,
    evalsPassedCount: 0,
    evalsFailedCount: 0,
    worstStatus: worstStatusOf(item),
    lastTraceId: item.lastTraceId,
    latestTimestamp: item.lastActivityMs,
    earliestTimestamp: item.startedAtMs,
    lastMessage: item.input ?? item.output ?? "",
    lastOutput: item.output ?? "",
    primaryModel: item.primaryModel,
    serviceName: item.serviceName,
    // The coding-agent fold's peak context is the sharper number when the
    // session has one; the per-trace attribute maximum covers everyone else.
    // `??`, not `||`: a session that has carried no context into any call yet
    // peaks at 0, and that 0 is the accurate answer, not a missing value.
    contextSizeTokens: item.codingAgent?.peakContextTokens ?? item.contextSizeTokens,
    ...codingAgentFields(item.codingAgent),
  };
}

/**
 * The coding-agent enrichment flattened onto the view model. An ordinary
 * conversation has no coding-agent row at all, and every field is then empty:
 * `titleRedacted` false, because there was no title to withhold.
 */
function codingAgentFields(
  codingAgent: SessionGroupPayloadItem["codingAgent"],
): Pick<
  ConversationGroup,
  | "modelCalls"
  | "compactions"
  | "repositoryHost"
  | "repositoryOwner"
  | "repositoryName"
  | "gitBranch"
  | "gitWorktree"
  | "title"
  | "titleRedacted"
  | "pullRequest"
> {
  if (codingAgent === null) {
    return {
      modelCalls: null,
      compactions: null,
      repositoryHost: null,
      repositoryOwner: null,
      repositoryName: null,
      gitBranch: null,
      gitWorktree: null,
      title: null,
      titleRedacted: false,
      pullRequest: null,
    };
  }
  return {
    modelCalls: codingAgent.modelCalls,
    compactions: codingAgent.compactions,
    repositoryHost: codingAgent.repositoryHost,
    repositoryOwner: codingAgent.repositoryOwner,
    repositoryName: codingAgent.repositoryName,
    gitBranch: codingAgent.gitBranch,
    gitWorktree: codingAgent.gitWorktree,
    title: codingAgent.title,
    titleRedacted: codingAgent.titleRedacted,
    pullRequest: codingAgent.pullRequest ?? null,
  };
}

export function mapSessionGroupsPayload(
  data: { sessions: SessionGroupPayloadItem[] } | undefined,
): ConversationGroup[] {
  if (!data) return [];
  return data.sessions.map(mapSessionGroupToConversationGroup);
}

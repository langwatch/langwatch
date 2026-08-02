import type { ConversationGroup } from "../components/TraceTable/conversationGroups";
import type { TraceStatus } from "../types/trace";

/**
 * One session row as returned by `tracesV2.sessions`, the server-side
 * rollup over every trace sharing a `gen_ai.conversation.id` in range
 * (specs/traces-v2/sessions-lens.feature). Declared structurally here so the
 * mapper stays testable without the tRPC client types.
 */
export interface SessionGroupPayloadItem {
  conversationId: string;
  traceCount: number;
  totalCost: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextSizeTokens: number | null;
  totalDurationMs: number;
  startedAtMs: number;
  lastActivityMs: number;
  models: string[];
  primaryModel: string;
  serviceName: string;
  errorCount: number;
  warningCount: number;
  totalSpans: number;
  input: string | null;
  output: string | null;
  codingAgent: {
    modelCalls: number;
    compactions: number;
    peakContextTokens: number;
    subAgents: number;
  } | null;
}

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
    latestTimestamp: item.lastActivityMs,
    earliestTimestamp: item.startedAtMs,
    lastMessage: item.input ?? item.output ?? "",
    lastOutput: item.output ?? "",
    primaryModel: item.primaryModel,
    serviceName: item.serviceName,
    // The coding-agent fold's peak context is the sharper number when the
    // session has one; the per-trace attribute maximum covers everyone else.
    contextSizeTokens:
      item.codingAgent?.peakContextTokens || item.contextSizeTokens,
    modelCalls: item.codingAgent?.modelCalls ?? null,
    compactions: item.codingAgent?.compactions ?? null,
  };
}

export function mapSessionGroupsPayload(
  data: { sessions: SessionGroupPayloadItem[] } | undefined,
): ConversationGroup[] {
  if (!data) return [];
  return data.sessions.map(mapSessionGroupToConversationGroup);
}

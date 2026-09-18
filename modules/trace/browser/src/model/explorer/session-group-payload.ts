/**
 * One session row as returned by `tracesV2.sessions`, the server-side rollup over every
 * trace sharing a `gen_ai.conversation.id` in range
 * (specs/traces-v2/sessions-lens.feature).
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
  /** The conversation's most recent trace; null when the rollup named none. */
  lastTraceId: string | null;
  input: string | null;
  output: string | null;
  codingAgent: {
    modelCalls: number;
    compactions: number;
    peakContextTokens: number;
    subAgents: number;
    repositoryHost: string | null;
    repositoryOwner: string | null;
    repositoryName: string | null;
    gitBranch: string | null;
    gitWorktree: string | null;
    /** Null both when there is no title and when the viewer may not read it. */
    title: string | null;
    /** True only when a title existed and the viewer may not read it. */
    titleRedacted: boolean;
    pullRequest: { number: number; htmlUrl: string; title: string } | null;
  } | null;
}

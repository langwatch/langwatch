/**
 * The Sessions lens read model (specs/traces-v2/sessions-lens.feature): one
 * row per `gen_ai.conversation.id`, with rollups computed over every trace of
 * the session in range.
 *
 * Here rather than beside the service that builds it for the same reason as
 * `TraceListItem`: the trace transport publishes these rows, and a payload
 * type declared in the application narrows to its constraint once the
 * transport is package-owned.
 */

export interface SessionGroupPullRequestDto {
  number: number;
  htmlUrl: string;
  title: string;
}

export interface SessionGroupCodingAgentDto {
  modelCalls: number;
  compactions: number;
  peakContextTokens: number;
  subAgents: number;
  /**
   * Where the session ran, from the LangWatch companion event, and the title
   * the agent generated for it. Null for every session whose agent has no
   * companion emitter, which is most of them.
   */
  repositoryHost: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  gitBranch: string | null;
  gitWorktree: string | null;
  title: string | null;
  /**
   * The pull request this session's work belongs to, decided by the tenure
   * rule over the branch's mapped pull requests. Null for a session with no
   * git context, a repository the organization's GitHub connection does not
   * reach, or a branch whose pull request has not been opened yet.
   */
  pullRequest: SessionGroupPullRequestDto | null;
}

export interface SessionGroupDto {
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
  /**
   * The session's most recent trace, the one a click on the row opens. Null
   * when the rollup named none.
   */
  lastTraceId: string | null;
  /** Latest trace's computed input/output previews for the row label. */
  input: string | null;
  output: string | null;
  /**
   * Pre-folded coding-agent counters when a `coding_agent_sessions` row
   * exists for this conversation id; null for ordinary conversations.
   */
  codingAgent: SessionGroupCodingAgentDto | null;
}

export interface SessionGroupsResult {
  sessions: SessionGroupDto[];
  totalHits: number;
  nextCursor: string | null;
}

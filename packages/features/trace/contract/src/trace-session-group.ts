import { z } from "zod";

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

export const sessionGroupPullRequestDtoSchema = z.object({
  number: z.number(),
  htmlUrl: z.string(),
  title: z.string(),
});

export type SessionGroupPullRequestDto = z.infer<typeof sessionGroupPullRequestDtoSchema>;

export const sessionGroupCodingAgentDtoSchema = z.object({
  modelCalls: z.number(),
  compactions: z.number(),
  peakContextTokens: z.number(),
  subAgents: z.number(),
  /**
   * Where the session ran, from the LangWatch companion event, and the title
   * the agent generated for it. Null for every session whose agent has no
   * companion emitter, which is most of them.
   */
  repositoryHost: z.string().nullable(),
  repositoryOwner: z.string().nullable(),
  repositoryName: z.string().nullable(),
  gitBranch: z.string().nullable(),
  gitWorktree: z.string().nullable(),
  title: z.string().nullable(),
  /**
   * The pull request this session's work belongs to, decided by the tenure
   * rule over the branch's mapped pull requests. Null for a session with no
   * git context, a repository the organization's GitHub connection does not
   * reach, or a branch whose pull request has not been opened yet.
   */
  pullRequest: sessionGroupPullRequestDtoSchema.nullable(),
});

export type SessionGroupCodingAgentDto = z.infer<typeof sessionGroupCodingAgentDtoSchema>;

export const sessionGroupDtoSchema = z.object({
  conversationId: z.string(),
  traceCount: z.number(),
  totalCost: z.number(),
  totalTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  contextSizeTokens: z.number().nullable(),
  totalDurationMs: z.number(),
  startedAtMs: z.number(),
  lastActivityMs: z.number(),
  models: z.array(z.string()),
  primaryModel: z.string(),
  serviceName: z.string(),
  errorCount: z.number(),
  warningCount: z.number(),
  totalSpans: z.number(),
  /**
   * The session's most recent trace, the one a click on the row opens. Null
   * when the rollup named none.
   */
  lastTraceId: z.string().nullable(),
  /** Latest trace's computed input/output previews for the row label. */
  input: z.string().nullable(),
  output: z.string().nullable(),
  /**
   * Pre-folded coding-agent counters when a `coding_agent_sessions` row
   * exists for this conversation id; null for ordinary conversations.
   */
  codingAgent: sessionGroupCodingAgentDtoSchema.nullable(),
});

export type SessionGroupDto = z.infer<typeof sessionGroupDtoSchema>;

export const sessionGroupsResultSchema = z.object({
  sessions: z.array(sessionGroupDtoSchema),
  totalHits: z.number(),
  nextCursor: z.string().nullable(),
});

export type SessionGroupsResult = z.infer<typeof sessionGroupsResultSchema>;

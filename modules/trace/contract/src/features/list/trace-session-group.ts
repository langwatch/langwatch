import { z } from "zod";

import {
  canReadCapturedContent,
  type Protections,
} from "../../trace-viewer-protections.contract.ts";

/**
 * The Sessions lens read model (specs/traces-v2/sessions-lens.feature): one
 * row per `gen_ai.conversation.id`, rollups over every trace of the session.
 */

const sessionGroupPullRequestDtoSchema = z.object({
  number: z.number(),
  htmlUrl: z.string(),
  title: z.string(),
});

export const sessionGroupCodingAgentDtoSchema = z.object({
  modelCalls: z.number(),
  compactions: z.number(),
  peakContextTokens: z.number(),
  subAgents: z.number(),
  /** Where the session ran (companion event) and its generated title; null for most agents. */
  repositoryHost: z.string().nullable(),
  repositoryOwner: z.string().nullable(),
  repositoryName: z.string().nullable(),
  gitBranch: z.string().nullable(),
  gitWorktree: z.string().nullable(),
  title: z.string().nullable(),
  /** The pull request this session's work belongs to (tenure rule); null with no git context. */
  pullRequest: sessionGroupPullRequestDtoSchema.nullable(),
});

export type SessionGroupCodingAgentDto = z.infer<typeof sessionGroupCodingAgentDtoSchema>;

export const sessionGroupDtoSchema = z.object({
  conversationId: z.string(),
  /** The project the session belongs to; on an aggregate, the member. */
  projectId: z.string(),
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

/**
 * Strip session title for viewers who cannot read captured content. `titleRedacted`
 * set only when a title existed (mirrors redactV2Content).
 */
export function gateSessionTitle<T extends { codingAgent: { title: string | null } | null }>({
  sessions,
  protections,
}: {
  sessions: T[];
  protections: Protections;
}): (T & {
  codingAgent: (NonNullable<T["codingAgent"]> & SessionTitleRedactionFlag) | null;
})[] {
  const contentVisible = canReadCapturedContent(protections);
  return sessions.map((session) => {
    const codingAgent = session.codingAgent as NonNullable<T["codingAgent"]> | null;
    return {
      ...session,
      codingAgent:
        codingAgent === null
          ? null
          : {
              ...codingAgent,
              title: contentVisible ? codingAgent.title : null,
              titleRedacted: !contentVisible && codingAgent.title !== null,
            },
    };
  });
}

/** What {@link gateSessionTitle} adds to a row's coding-agent enrichment. */
export interface SessionTitleRedactionFlag {
  /** True only when a title existed and this viewer may not read it. */
  titleRedacted: boolean;
}

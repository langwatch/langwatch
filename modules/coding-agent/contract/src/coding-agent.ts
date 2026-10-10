import type { Named } from "@langwatch/module";
import { z } from "zod";

const countByNameSchema = z.record(z.string(), z.number());
// The legacy service deliberately accepts non-finite limits and clamps them
// to its safe page size. Keep that behaviour at the new boundary.
const legacyPageLimitSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Number.POSITIVE_INFINITY),
  z.literal(Number.NEGATIVE_INFINITY),
]);

/** The service never asks persistence for more events than this. */
export const MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE = 1000;

const codingAgentMetricSeriesRowSchemaDefinition = z
  .object({
    seriesId: z.string(),
    metricName: z.string(),
    type: z.string(),
    decision: z.string(),
    language: z.string(),
    value: z.number(),
  })
  .strict();
export interface CodingAgentMetricSeriesRowSchema extends Named<
  typeof codingAgentMetricSeriesRowSchemaDefinition
> {}
export const codingAgentMetricSeriesRowSchema: CodingAgentMetricSeriesRowSchema =
  codingAgentMetricSeriesRowSchemaDefinition;

/**
 * What a session spent under one declared working context: the repository and branch a model call
 * was stamped with, and the tokens and computed cost of every call stamped the same way. Never a
 * share: the amounts are the calls' own, and the pull-request split divides them (migration 00099).
 */
const codingAgentSessionContextUsageSchemaDefinition = z
  .object({
    repositoryHost: z.string(),
    repositoryOwner: z.string(),
    repositoryName: z.string(),
    branch: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    costUsd: z.number(),
  })
  .strict();
export interface CodingAgentSessionContextUsageSchema extends Named<
  typeof codingAgentSessionContextUsageSchemaDefinition
> {}
export const codingAgentSessionContextUsageSchema: CodingAgentSessionContextUsageSchema =
  codingAgentSessionContextUsageSchemaDefinition;
export type CodingAgentSessionContextUsage = z.infer<typeof codingAgentSessionContextUsageSchema>;

/** The complete durable `coding_agent_sessions` read row. */
const codingAgentSessionSchemaDefinition = z
  .object({
    tenantId: z.string(),
    sessionId: z.string(),
    sessionKeySource: z.string(),
    version: z.string(),
    startedAtMs: z.number(),
    agent: z.string(),
    agentVersion: z.string(),
    traceIds: z.array(z.string()),
    finalRequestId: z.string(),
    userId: z.string(),
    terminalType: z.string(),
    entrypoint: z.string(),
    parentSessionId: z.string(),
    isFork: z.boolean(),
    /** A thread the agent ran for itself (00096): kept and priced, never listed as a session. */
    auxiliary: z.boolean().default(false),
    repositoryHost: z.string(),
    repositoryOwner: z.string(),
    repositoryName: z.string(),
    gitBranch: z.string(),
    gitBranches: z.array(z.string()),
    /** Where the session's usage went; empty on a row folded before 00099. */
    usageByContext: z.array(codingAgentSessionContextUsageSchema).default([]),
    gitWorktree: z.string(),
    title: z.string(),
    titleSource: z.string(),
    modelCalls: z.number(),
    toolCalls: z.number(),
    subAgents: z.number(),
    prompts: z.number(),
    promptChars: z.number(),
    responseChars: z.number(),
    steps: z.array(z.tuple([z.string(), z.number(), z.boolean()])),
    toolCounts: countByNameSchema,
    toolDurationMs: countByNameSchema,
    filesTouched: z.array(z.string()),
    skills: z.array(z.string()),
    subAgentTypes: z.array(z.string()),
    slashCommands: z.array(z.string()),
    models: z.array(z.string()),
    mcpServers: z.array(z.string()),
    mcpTools: z.array(z.string()),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    costUsd: z.number(),
    agentReportedCostUsd: z.number(),
    modelCallMs: z.number(),
    toolMs: z.number(),
    ttftMsTotal: z.number(),
    ttftSamples: z.number(),
    blockedOnUserMs: z.number(),
    activeTimeUserSec: z.number(),
    activeTimeCliSec: z.number(),
    toolResultBytes: z.number(),
    toolInputBytes: z.number(),
    compactions: z.number(),
    compactionTokensBefore: z.number(),
    compactionTokensAfter: z.number(),
    compactionTriggers: countByNameSchema,
    peakContextTokens: z.number(),
    cacheRebuildCount: z.number(),
    largestCacheRebuildTokens: z.number(),
    failedTools: z.number(),
    errorTypes: countByNameSchema,
    apiErrors: z.number(),
    rateLimited: z.number(),
    rateLimitEvents: z.number(),
    retriesExhausted: z.number(),
    retryMs: z.number(),
    attempts: z.number(),
    refusals: z.number(),
    refusalCategories: z.array(z.string()),
    internalErrors: z.number(),
    toolsDenied: z.number(),
    toolsAborted: z.number(),
    permissionMode: z.string(),
    permissionChanges: z.number(),
    hooksBlocked: z.number(),
    hooksCancelled: z.number(),
    hookMs: z.number(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
    commits: z.number(),
    pullRequests: z.number(),
    editsAccepted: z.number(),
    editsRejected: z.number(),
    languagesEdited: z.array(z.string()),
    atMentions: z.number(),
    stopReason: z.string(),
    truncated: z.boolean(),
    subAgentIds: z.array(z.string()),
    stepStartedAt: z.array(z.number()),
    previousCallContextTokens: z.number(),
    metricSeries: z.array(codingAgentMetricSeriesRowSchema),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastEventOccurredAt: z.number(),
  })
  .strict();
export interface CodingAgentSessionSchema extends Named<
  typeof codingAgentSessionSchemaDefinition
> {}
export const codingAgentSessionSchema: CodingAgentSessionSchema =
  codingAgentSessionSchemaDefinition;

const codingAgentSessionEventSchemaDefinition = z
  .object({
    sessionId: z.string(),
    timeUnixMs: z.number(),
    recordId: z.string(),
    eventKind: z.string(),
    agent: z.string(),
    sessionKeySource: z.string(),
    traceId: z.string(),
    spanId: z.string(),
    promptId: z.string(),
    querySource: z.string(),
    agentType: z.string(),
    eventSequence: z.number(),
    requestId: z.string(),
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    costUsd: z.number(),
    durationMs: z.number(),
    ttftMs: z.number(),
    attempt: z.number(),
    speed: z.string(),
    stopReason: z.string(),
    preTokens: z.number(),
    postTokens: z.number(),
    compactionTrigger: z.string(),
    precomputeReuse: z.string(),
    statusCode: z.string(),
    errorType: z.string(),
    rateLimitCarrier: z.string(),
    retryDurationMs: z.number(),
    toolName: z.string(),
    success: z.string(),
    decision: z.string(),
    decisionSource: z.string(),
    toolInputBytes: z.number(),
    toolResultBytes: z.number(),
    promptChars: z.number(),
    totalTokens: z.number(),
    /**
     * The working context active when the event happened, stamped from the
     * session's last `session_context` declaration. '' on pre-declaration rows;
     * this is what lets one session's cost split across every pull request it drove.
     */
    repositoryHost: z.string(),
    repositoryOwner: z.string(),
    repositoryName: z.string(),
    branch: z.string(),
  })
  .strict();
export interface CodingAgentSessionEventSchema extends Named<
  typeof codingAgentSessionEventSchemaDefinition
> {}
export const codingAgentSessionEventSchema: CodingAgentSessionEventSchema =
  codingAgentSessionEventSchemaDefinition;

/** One durable row in the ordered coding-agent session-event read model. */
const codingAgentSessionEventRecordSchemaDefinition = codingAgentSessionEventSchema
  .safeExtend({ tenantId: z.string() })
  .strict();
export interface CodingAgentSessionEventRecordSchema extends Named<
  typeof codingAgentSessionEventRecordSchemaDefinition
> {}
export const codingAgentSessionEventRecordSchema: CodingAgentSessionEventRecordSchema =
  codingAgentSessionEventRecordSchemaDefinition;

/** One durable trace-to-session mapping written by the projection. */
const codingAgentTraceSessionRecordSchemaDefinition = z
  .object({
    tenantId: z.string(),
    traceId: z.string(),
    sessionId: z.string(),
    occurredAtMs: z.number(),
  })
  .strict();
export interface CodingAgentTraceSessionRecordSchema extends Named<
  typeof codingAgentTraceSessionRecordSchemaDefinition
> {}
export const codingAgentTraceSessionRecordSchema: CodingAgentTraceSessionRecordSchema =
  codingAgentTraceSessionRecordSchemaDefinition;

/** One converged session metric unit written by the projection. */
const codingAgentSessionMetricSeriesRecordSchemaDefinition = z
  .object({
    tenantId: z.string(),
    sessionId: z.string(),
    seriesId: z.string(),
    metricName: z.string(),
    metricUnit: z.string(),
    agent: z.string(),
    attributes: z.record(z.string(), z.string()),
    value: z.number(),
    dataPointCount: z.number(),
    asOfUnixMs: z.number(),
  })
  .strict();
export interface CodingAgentSessionMetricSeriesRecordSchema extends Named<
  typeof codingAgentSessionMetricSeriesRecordSchemaDefinition
> {}
export const codingAgentSessionMetricSeriesRecordSchema: CodingAgentSessionMetricSeriesRecordSchema =
  codingAgentSessionMetricSeriesRecordSchemaDefinition;

/** The bounded, content-free session fact read for pull-request aggregation. */
const codingAgentSessionBranchRecordSchemaDefinition = z
  .object({
    sessionId: z.string(),
    tenantId: z.string(),
    startedAtMs: z.number(),
    lastEventOccurredAtMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    costUsd: z.number(),
    agent: z.string(),
    models: z.array(z.string()),
    userId: z.string(),
    gitBranch: z.string(),
    gitBranches: z.array(z.string()),
    /** The split's ledger; empty on a row folded before 00099. */
    usageByContext: z.array(codingAgentSessionContextUsageSchema).default([]),
    title: z.string(),
  })
  .strict();
export interface CodingAgentSessionBranchRecordSchema extends Named<
  typeof codingAgentSessionBranchRecordSchemaDefinition
> {}
export const codingAgentSessionBranchRecordSchema: CodingAgentSessionBranchRecordSchema =
  codingAgentSessionBranchRecordSchemaDefinition;

const codingAgentSessionCursorSchemaDefinition = z
  .object({ timeUnixMs: z.number(), recordId: z.string() })
  .strict();
export interface CodingAgentSessionCursorSchema extends Named<
  typeof codingAgentSessionCursorSchemaDefinition
> {}
export const codingAgentSessionCursorSchema: CodingAgentSessionCursorSchema =
  codingAgentSessionCursorSchemaDefinition;

const codingAgentSessionEventsInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    sessionId: z.string(),
    kinds: z.array(z.string()).optional(),
    occurredAt: z.object({ fromMs: z.number(), toMs: z.number() }).strict().optional(),
    cursor: codingAgentSessionCursorSchema.optional(),
    limit: legacyPageLimitSchema,
  })
  .strict();
export interface CodingAgentSessionEventsInputSchema extends Named<
  typeof codingAgentSessionEventsInputSchemaDefinition
> {}
export const codingAgentSessionEventsInputSchema: CodingAgentSessionEventsInputSchema =
  codingAgentSessionEventsInputSchemaDefinition;

/** Every event kind the session-events read model can report. */
export const CODING_AGENT_SESSION_EVENT_KINDS = [
  "model_call",
  "compaction",
  "rate_limit",
  "api_error",
  "retries_exhausted",
  "tool_result",
  "tool_decision",
  "user_prompt",
  "subagent_completed",
] as const;

/** Default page size for `GET .../sessions/:sessionId/events` when no `limit` is given. */
export const CODING_AGENT_SESSION_EVENTS_DEFAULT_PAGE_SIZE = 500;

/** `GET .../sessions/:sessionId/events` path param. */
const codingAgentSessionEventsRestParamsSchemaDefinition = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe("The agent's own session id (session.id / conversation id)."),
});
export interface CodingAgentSessionEventsRestParamsSchema extends Named<
  typeof codingAgentSessionEventsRestParamsSchemaDefinition
> {}
export const codingAgentSessionEventsRestParamsSchema: CodingAgentSessionEventsRestParamsSchema =
  codingAgentSessionEventsRestParamsSchemaDefinition;

/**
 * Query parsing that REFUSES what it cannot honour. `cursor` stays an opaque
 * string: decoding it needs `Buffer`, absent from this platform-neutral
 * package — the transport decodes it and throws on a bad value.
 */
const codingAgentSessionEventsRestQuerySchemaDefinition = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE)
    .default(CODING_AGENT_SESSION_EVENTS_DEFAULT_PAGE_SIZE),
  kinds: z
    .string()
    .optional()
    .describe(
      `Comma-separated event kinds to include. Known kinds: ${CODING_AGENT_SESSION_EVENT_KINDS.join(", ")}.`,
    )
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((kind) => kind.trim())
            .filter((kind) => kind.length > 0)
        : undefined,
    ),
  from: z.coerce
    .number()
    .finite()
    .optional()
    .describe(
      "Epoch ms lower bound on event time; with `to`, prunes storage partitions for faster reads.",
    ),
  to: z.coerce.number().finite().optional().describe("Epoch ms upper bound on event time."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque keyset cursor from the previous response's nextCursor."),
});
export interface CodingAgentSessionEventsRestQuerySchema extends Named<
  typeof codingAgentSessionEventsRestQuerySchemaDefinition
> {}
export const codingAgentSessionEventsRestQuerySchema: CodingAgentSessionEventsRestQuerySchema =
  codingAgentSessionEventsRestQuerySchemaDefinition;

const codingAgentSessionEventsRestResponseSchemaDefinition = z.object({
  events: z.array(codingAgentSessionEventSchema),
  nextCursor: z.string().nullable(),
});
export interface CodingAgentSessionEventsRestResponseSchema extends Named<
  typeof codingAgentSessionEventsRestResponseSchemaDefinition
> {}
export const codingAgentSessionEventsRestResponseSchema: CodingAgentSessionEventsRestResponseSchema =
  codingAgentSessionEventsRestResponseSchemaDefinition;

/** One page of a session's events as the REST door asks for it: its query and whose session. */
export type CodingAgentSessionEventsPageInput = z.output<
  typeof codingAgentSessionEventsRestQuerySchema
> & { projectId: string; sessionId: string };
/** The page the REST door answers, its keyset cursor already encoded. */
export type CodingAgentSessionEventsPage = z.infer<
  typeof codingAgentSessionEventsRestResponseSchema
>;

const codingAgentSessionLookupInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    sessionId: z.string(),
    startedAtMs: z.number().optional(),
  })
  .strict();
export interface CodingAgentSessionLookupInputSchema extends Named<
  typeof codingAgentSessionLookupInputSchemaDefinition
> {}
export const codingAgentSessionLookupInputSchema: CodingAgentSessionLookupInputSchema =
  codingAgentSessionLookupInputSchemaDefinition;

const codingAgentTraceSessionLookupInputSchemaDefinition = z
  .object({ projectId: z.string(), traceId: z.string() })
  .strict();
export interface CodingAgentTraceSessionLookupInputSchema extends Named<
  typeof codingAgentTraceSessionLookupInputSchemaDefinition
> {}
export const codingAgentTraceSessionLookupInputSchema: CodingAgentTraceSessionLookupInputSchema =
  codingAgentTraceSessionLookupInputSchemaDefinition;

const codingAgentRecentSessionsInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    userId: z.string().optional(),
    fromMs: z.number(),
    toMs: z.number(),
    limit: z.number().optional(),
  })
  .strict();
export interface CodingAgentRecentSessionsInputSchema extends Named<
  typeof codingAgentRecentSessionsInputSchemaDefinition
> {}
export const codingAgentRecentSessionsInputSchema: CodingAgentRecentSessionsInputSchema =
  codingAgentRecentSessionsInputSchemaDefinition;

/** Requests bounded pull-request mapping for recent session branches. */
const codingAgentPullRequestMappingBackfillInputSchemaDefinition = z
  .object({ organizationId: z.string() })
  .strict();
export interface CodingAgentPullRequestMappingBackfillInputSchema extends Named<
  typeof codingAgentPullRequestMappingBackfillInputSchemaDefinition
> {}
export const codingAgentPullRequestMappingBackfillInputSchema: CodingAgentPullRequestMappingBackfillInputSchema =
  codingAgentPullRequestMappingBackfillInputSchemaDefinition;

const codingAgentUsageTotalsSchemaDefinition = z
  .object({
    sessionCount: z.number(),
    costUsd: z.number(),
    totalTokens: z.number(),
    activeTimeSec: z.number(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
    commits: z.number(),
    pullRequests: z.number(),
  })
  .strict();
export interface CodingAgentUsageTotalsSchema extends Named<
  typeof codingAgentUsageTotalsSchemaDefinition
> {}
export const codingAgentUsageTotalsSchema: CodingAgentUsageTotalsSchema =
  codingAgentUsageTotalsSchemaDefinition;

const codingAgentUsageTotalsInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    userId: z.string().optional(),
    fromMs: z.number(),
    toMs: z.number(),
  })
  .strict();
export interface CodingAgentUsageTotalsInputSchema extends Named<
  typeof codingAgentUsageTotalsInputSchemaDefinition
> {}
export const codingAgentUsageTotalsInputSchema: CodingAgentUsageTotalsInputSchema =
  codingAgentUsageTotalsInputSchemaDefinition;

const codingAgentSessionListPullRequestSchemaDefinition = z
  .object({ number: z.number(), url: z.string(), title: z.string() })
  .strict();
export interface CodingAgentSessionListPullRequestSchema extends Named<
  typeof codingAgentSessionListPullRequestSchemaDefinition
> {}
export const codingAgentSessionListPullRequestSchema: CodingAgentSessionListPullRequestSchema =
  codingAgentSessionListPullRequestSchemaDefinition;

/** The exact row returned by the sessions screen. */
const codingAgentSessionListRowSchemaDefinition = z
  .object({
    sessionId: z.string(),
    title: z.string().nullable(),
    agent: z.string(),
    agentVersion: z.string(),
    repositoryHost: z.string(),
    repositoryOwner: z.string(),
    repositoryName: z.string(),
    gitBranch: z.string(),
    gitBranches: z.array(z.string()),
    startedAtMs: z.number(),
    lastEventOccurredAtMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    costUsd: z.number().nullable(),
    peakContextTokens: z.number(),
    compactions: z.number(),
    compactionTokensBefore: z.number(),
    compactionTokensAfter: z.number(),
    cacheRebuildCount: z.number(),
    largestCacheRebuildTokens: z.number(),
    activeTimeCliSec: z.number(),
    blockedOnUserMs: z.number(),
    models: z.array(z.string()),
    pullRequests: z.array(codingAgentSessionListPullRequestSchema),
  })
  .strict();
export interface CodingAgentSessionListRowSchema extends Named<
  typeof codingAgentSessionListRowSchemaDefinition
> {}
export const codingAgentSessionListRowSchema: CodingAgentSessionListRowSchema =
  codingAgentSessionListRowSchemaDefinition;

const codingAgentSessionsListInputSchemaDefinition = z.object({ projectId: z.string() }).strict();
export interface CodingAgentSessionsListInputSchema extends Named<
  typeof codingAgentSessionsListInputSchemaDefinition
> {}
export const codingAgentSessionsListInputSchema: CodingAgentSessionsListInputSchema =
  codingAgentSessionsListInputSchemaDefinition;

const codingAgentContributorProjectSchemaDefinition = z
  .object({
    slug: z.string(),
    contributorLabel: z.string(),
    isLinkable: z.boolean(),
  })
  .strict();
export interface CodingAgentContributorProjectSchema extends Named<
  typeof codingAgentContributorProjectSchemaDefinition
> {}
export const codingAgentContributorProjectSchema: CodingAgentContributorProjectSchema =
  codingAgentContributorProjectSchemaDefinition;

const codingAgentPullRequestIdentitySchemaDefinition = z
  .object({
    repositoryHost: z.string(),
    repositoryFullName: z.string(),
    prNumber: z.number(),
    headBranch: z.string(),
    htmlUrl: z.string(),
    state: z.string(),
    isDraft: z.boolean(),
    authorLogin: z.string().nullable(),
    prCreatedAtMs: z.number(),
    prClosedAtMs: z.number().nullable(),
    prMergedAtMs: z.number().nullable(),
  })
  .strict();
export interface CodingAgentPullRequestIdentitySchema extends Named<
  typeof codingAgentPullRequestIdentitySchemaDefinition
> {}
export const codingAgentPullRequestIdentitySchema: CodingAgentPullRequestIdentitySchema =
  codingAgentPullRequestIdentitySchemaDefinition;

const codingAgentCostSplitSchemaDefinition = z
  .object({
    costUsd: z.number().nullable(),
    billedCostUsd: z.number().nullable(),
    nonBilledCostUsd: z.number().nullable(),
  })
  .strict();
export interface CodingAgentCostSplitSchema extends Named<
  typeof codingAgentCostSplitSchemaDefinition
> {}
export const codingAgentCostSplitSchema: CodingAgentCostSplitSchema =
  codingAgentCostSplitSchemaDefinition;

const codingAgentModelUsageSchemaDefinition = z
  .object({
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    totalTokens: z.number(),
    costUsd: z.number().nullable(),
    tokensKnown: z.boolean(),
  })
  .strict();
export interface CodingAgentModelUsageSchema extends Named<
  typeof codingAgentModelUsageSchemaDefinition
> {}
export const codingAgentModelUsageSchema: CodingAgentModelUsageSchema =
  codingAgentModelUsageSchemaDefinition;

const codingAgentContributorIdentityShape = {
  projectId: z.string(),
  projectSlug: z.string(),
  contributorLabel: z.string(),
  contributorIsProject: z.boolean(),
};

const codingAgentPullRequestUsageRowSchemaDefinition = z
  .object({
    ...codingAgentContributorIdentityShape,
    agent: z.string(),
    models: z.array(z.string()),
    sessionsCount: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    totalTokens: z.number(),
    costUsd: z.number().nullable(),
    billedCostUsd: z.number().nullable(),
    nonBilledCostUsd: z.number().nullable(),
  })
  .strict();
export interface CodingAgentPullRequestUsageRowSchema extends Named<
  typeof codingAgentPullRequestUsageRowSchemaDefinition
> {}
export const codingAgentPullRequestUsageRowSchema: CodingAgentPullRequestUsageRowSchema =
  codingAgentPullRequestUsageRowSchemaDefinition;

const codingAgentPullRequestUsageTotalsSchemaDefinition = z
  .object({
    sessionsCount: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    totalTokens: z.number(),
    costUsd: z.number().nullable(),
    billedCostUsd: z.number().nullable(),
    nonBilledCostUsd: z.number().nullable(),
  })
  .strict();
export interface CodingAgentPullRequestUsageTotalsSchema extends Named<
  typeof codingAgentPullRequestUsageTotalsSchemaDefinition
> {}
export const codingAgentPullRequestUsageTotalsSchema: CodingAgentPullRequestUsageTotalsSchema =
  codingAgentPullRequestUsageTotalsSchemaDefinition;

const codingAgentPullRequestUsageSchemaDefinition = z
  .object({
    pullRequest: codingAgentPullRequestIdentitySchema,
    rows: z.array(codingAgentPullRequestUsageRowSchema),
    totals: codingAgentPullRequestUsageTotalsSchema,
    modelBreakdown: z.array(codingAgentModelUsageSchema),
  })
  .strict();
export interface CodingAgentPullRequestUsageSchema extends Named<
  typeof codingAgentPullRequestUsageSchemaDefinition
> {}
export const codingAgentPullRequestUsageSchema: CodingAgentPullRequestUsageSchema =
  codingAgentPullRequestUsageSchemaDefinition;

const codingAgentContributorSummarySchemaDefinition = z
  .object({ ...codingAgentContributorIdentityShape, sessionsCount: z.number() })
  .strict();
export interface CodingAgentContributorSummarySchema extends Named<
  typeof codingAgentContributorSummarySchemaDefinition
> {}
export const codingAgentContributorSummarySchema: CodingAgentContributorSummarySchema =
  codingAgentContributorSummarySchemaDefinition;

const codingAgentPersonalPullRequestRowSchemaDefinition = z
  .object({
    ...codingAgentPullRequestIdentitySchema.shape,
    title: z.string(),
    lastActivityAtMs: z.number(),
    sessionsCount: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    totalTokens: z.number(),
    costUsd: z.number().nullable(),
    billedCostUsd: z.number().nullable(),
    nonBilledCostUsd: z.number().nullable(),
    modelBreakdown: z.array(codingAgentModelUsageSchema),
    contributorsSummary: z.array(codingAgentContributorSummarySchema),
  })
  .strict();
export interface CodingAgentPersonalPullRequestRowSchema extends Named<
  typeof codingAgentPersonalPullRequestRowSchemaDefinition
> {}
export const codingAgentPersonalPullRequestRowSchema: CodingAgentPersonalPullRequestRowSchema =
  codingAgentPersonalPullRequestRowSchemaDefinition;

const codingAgentUnlinkedBranchRollupSchemaDefinition = z
  .object({
    repositoryHost: z.string(),
    repositoryFullName: z.string(),
    headBranch: z.string(),
    lastActivityAtMs: z.number(),
    sessionsCount: z.number(),
    totalTokens: z.number(),
    modelBreakdown: z.array(codingAgentModelUsageSchema),
    costUsd: z.number().nullable(),
    billedCostUsd: z.number().nullable(),
    nonBilledCostUsd: z.number().nullable(),
    repoCovered: z.boolean(),
  })
  .strict();
export interface CodingAgentUnlinkedBranchRollupSchema extends Named<
  typeof codingAgentUnlinkedBranchRollupSchemaDefinition
> {}
export const codingAgentUnlinkedBranchRollupSchema: CodingAgentUnlinkedBranchRollupSchema =
  codingAgentUnlinkedBranchRollupSchemaDefinition;

const codingAgentPersonalPullRequestUsageSchemaDefinition = z
  .object({
    rows: z.array(codingAgentPersonalPullRequestRowSchema),
    unlinked: z.array(codingAgentUnlinkedBranchRollupSchema),
  })
  .strict();
export interface CodingAgentPersonalPullRequestUsageSchema extends Named<
  typeof codingAgentPersonalPullRequestUsageSchemaDefinition
> {}
export const codingAgentPersonalPullRequestUsageSchema: CodingAgentPersonalPullRequestUsageSchema =
  codingAgentPersonalPullRequestUsageSchemaDefinition;

const codingAgentPullRequestSessionFactSchemaDefinition = z
  .object({
    ...codingAgentContributorIdentityShape,
    sessionId: z.string(),
    startedAtMs: z.number(),
    agent: z.string(),
    totalTokens: z.number(),
    costUsd: z.number().nullable(),
    title: z.string().nullable(),
  })
  .strict();
export interface CodingAgentPullRequestSessionFactSchema extends Named<
  typeof codingAgentPullRequestSessionFactSchemaDefinition
> {}
export const codingAgentPullRequestSessionFactSchema: CodingAgentPullRequestSessionFactSchema =
  codingAgentPullRequestSessionFactSchemaDefinition;

const codingAgentPullRequestDetailSchemaDefinition = z
  .object({
    pullRequest: z
      .object({ ...codingAgentPullRequestIdentitySchema.shape, title: z.string() })
      .strict(),
    totals: codingAgentPullRequestUsageTotalsSchema,
    contributors: z.array(codingAgentPullRequestUsageRowSchema),
    modelBreakdown: z.array(codingAgentModelUsageSchema),
    sessions: z.array(codingAgentPullRequestSessionFactSchema),
  })
  .strict();
export interface CodingAgentPullRequestDetailSchema extends Named<
  typeof codingAgentPullRequestDetailSchemaDefinition
> {}
export const codingAgentPullRequestDetailSchema: CodingAgentPullRequestDetailSchema =
  codingAgentPullRequestDetailSchemaDefinition;

const codingAgentCallerScopeShape = {
  permittedProjectIds: z.array(z.string()),
  costProjectIds: z.array(z.string()),
  projects: z.record(z.string(), codingAgentContributorProjectSchema),
};

const codingAgentPullRequestUsageInputSchemaDefinition = z
  .object({
    ...codingAgentCallerScopeShape,
    organizationId: z.string(),
    repositoryHost: z.string(),
    repositoryFullName: z.string(),
    prNumber: z.number(),
  })
  .strict();
export interface CodingAgentPullRequestUsageInputSchema extends Named<
  typeof codingAgentPullRequestUsageInputSchemaDefinition
> {}
export const codingAgentPullRequestUsageInputSchema: CodingAgentPullRequestUsageInputSchema =
  codingAgentPullRequestUsageInputSchemaDefinition;

const codingAgentPersonalPullRequestUsageInputSchemaDefinition = z
  .object({ ...codingAgentCallerScopeShape, projectId: z.string() })
  .strict();
export interface CodingAgentPersonalPullRequestUsageInputSchema extends Named<
  typeof codingAgentPersonalPullRequestUsageInputSchemaDefinition
> {}
export const codingAgentPersonalPullRequestUsageInputSchema: CodingAgentPersonalPullRequestUsageInputSchema =
  codingAgentPersonalPullRequestUsageInputSchemaDefinition;

export type CodingAgentSession = z.infer<typeof codingAgentSessionSchema>;
export type CodingAgentSessionEvent = z.infer<typeof codingAgentSessionEventSchema>;
export type CodingAgentSessionEventRecord = z.infer<typeof codingAgentSessionEventRecordSchema>;
export type CodingAgentTraceSessionRecord = z.infer<typeof codingAgentTraceSessionRecordSchema>;
export type CodingAgentSessionMetricSeriesRecord = z.infer<
  typeof codingAgentSessionMetricSeriesRecordSchema
>;
export type CodingAgentSessionBranchRecord = z.infer<typeof codingAgentSessionBranchRecordSchema>;
export type CodingAgentSessionCursor = z.infer<typeof codingAgentSessionCursorSchema>;
export type CodingAgentSessionEventsInput = z.infer<typeof codingAgentSessionEventsInputSchema>;
export type CodingAgentSessionLookupInput = z.infer<typeof codingAgentSessionLookupInputSchema>;
export type CodingAgentTraceSessionLookupInput = z.infer<
  typeof codingAgentTraceSessionLookupInputSchema
>;
export type CodingAgentRecentSessionsInput = z.infer<typeof codingAgentRecentSessionsInputSchema>;
export type CodingAgentPullRequestMappingBackfillInput = z.infer<
  typeof codingAgentPullRequestMappingBackfillInputSchema
>;
export type CodingAgentUsageTotals = z.infer<typeof codingAgentUsageTotalsSchema>;
export type CodingAgentUsageTotalsInput = z.infer<typeof codingAgentUsageTotalsInputSchema>;
export type CodingAgentSessionListRow = z.infer<typeof codingAgentSessionListRowSchema>;
export type CodingAgentSessionsListInput = z.infer<typeof codingAgentSessionsListInputSchema>;
export type CodingAgentContributorProject = z.infer<typeof codingAgentContributorProjectSchema>;
export type CodingAgentPullRequestUsageInput = z.infer<
  typeof codingAgentPullRequestUsageInputSchema
>;
export type CodingAgentPersonalPullRequestUsageInput = z.infer<
  typeof codingAgentPersonalPullRequestUsageInputSchema
>;
export type CodingAgentPullRequestUsage = z.infer<typeof codingAgentPullRequestUsageSchema>;
export type CodingAgentPersonalPullRequestUsage = z.infer<
  typeof codingAgentPersonalPullRequestUsageSchema
>;
export type CodingAgentPullRequestDetail = z.infer<typeof codingAgentPullRequestDetailSchema>;

/** Whether GitHub is connected for an organization, and where to connect it. */
const codingAgentGithubConnectionSchemaDefinition = z
  .object({ connected: z.boolean(), installUrl: z.string().nullable() })
  .strict();
export interface CodingAgentGithubConnectionSchema extends Named<
  typeof codingAgentGithubConnectionSchemaDefinition
> {}
export const codingAgentGithubConnectionSchema: CodingAgentGithubConnectionSchema =
  codingAgentGithubConnectionSchemaDefinition;
export type CodingAgentGithubConnection = z.infer<typeof codingAgentGithubConnectionSchema>;

/**
 * The personal project's pull requests and unmapped branches, plus whether
 * GitHub is connected — all three at once, because the page needs all three to
 * decide what to render.
 */
const codingAgentPersonalPullRequestUsageWithConnectionSchemaDefinition =
  codingAgentPersonalPullRequestUsageSchema.safeExtend({
    connection: codingAgentGithubConnectionSchema,
  });
export interface CodingAgentPersonalPullRequestUsageWithConnectionSchema extends Named<
  typeof codingAgentPersonalPullRequestUsageWithConnectionSchemaDefinition
> {}
export const codingAgentPersonalPullRequestUsageWithConnectionSchema: CodingAgentPersonalPullRequestUsageWithConnectionSchema =
  codingAgentPersonalPullRequestUsageWithConnectionSchemaDefinition;

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

export const codingAgentMetricSeriesRowSchema = z
  .object({
    seriesId: z.string(),
    metricName: z.string(),
    type: z.string(),
    decision: z.string(),
    language: z.string(),
    value: z.number(),
  })
  .strict();

/** The complete durable `coding_agent_sessions` read row. */
export const codingAgentSessionSchema = z
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
    repositoryHost: z.string(),
    repositoryOwner: z.string(),
    repositoryName: z.string(),
    gitBranch: z.string(),
    gitBranches: z.array(z.string()),
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

export const codingAgentSessionEventSchema = z
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
  })
  .strict();

/** One durable row in the ordered coding-agent session-event read model. */
export const codingAgentSessionEventRecordSchema = codingAgentSessionEventSchema
  .extend({ tenantId: z.string() })
  .strict();

/** One durable trace-to-session mapping written by the projection. */
export const codingAgentTraceSessionRecordSchema = z
  .object({
    tenantId: z.string(),
    traceId: z.string(),
    sessionId: z.string(),
    occurredAtMs: z.number(),
  })
  .strict();

/** One converged session metric unit written by the projection. */
export const codingAgentSessionMetricSeriesRecordSchema = z
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

/** The bounded, content-free session fact read for pull-request aggregation. */
export const codingAgentSessionBranchRecordSchema = z
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
    title: z.string(),
  })
  .strict();

export const codingAgentSessionCursorSchema = z
  .object({ timeUnixMs: z.number(), recordId: z.string() })
  .strict();

export const codingAgentSessionEventsInputSchema = z
  .object({
    projectId: z.string(),
    sessionId: z.string(),
    kinds: z.array(z.string()).optional(),
    occurredAt: z.object({ fromMs: z.number(), toMs: z.number() }).strict().optional(),
    cursor: codingAgentSessionCursorSchema.optional(),
    limit: legacyPageLimitSchema,
  })
  .strict();

export const codingAgentSessionLookupInputSchema = z
  .object({
    projectId: z.string(),
    sessionId: z.string(),
    startedAtMs: z.number().optional(),
  })
  .strict();

export const codingAgentTraceSessionLookupInputSchema = z
  .object({ projectId: z.string(), traceId: z.string() })
  .strict();

export const codingAgentRecentSessionsInputSchema = z
  .object({
    projectId: z.string(),
    userId: z.string().optional(),
    fromMs: z.number(),
    toMs: z.number(),
    limit: z.number().optional(),
  })
  .strict();

/** Requests bounded pull-request mapping for recent session branches. */
export const codingAgentPullRequestMappingBackfillInputSchema = z
  .object({ organizationId: z.string() })
  .strict();

export const codingAgentUsageTotalsSchema = z
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

export const codingAgentUsageTotalsInputSchema = z
  .object({
    projectId: z.string(),
    userId: z.string().optional(),
    fromMs: z.number(),
    toMs: z.number(),
  })
  .strict();

export const codingAgentSessionListPullRequestSchema = z
  .object({ number: z.number(), url: z.string(), title: z.string() })
  .strict();

/** The exact row returned by the sessions screen. */
export const codingAgentSessionListRowSchema = z
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

export const codingAgentSessionsListInputSchema = z
  .object({ projectId: z.string() })
  .strict();

export const codingAgentContributorProjectSchema = z
  .object({
    slug: z.string(),
    contributorLabel: z.string(),
    isLinkable: z.boolean(),
  })
  .strict();

export const codingAgentPullRequestIdentitySchema = z
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

export const codingAgentCostSplitSchema = z
  .object({
    costUsd: z.number().nullable(),
    billedCostUsd: z.number().nullable(),
    nonBilledCostUsd: z.number().nullable(),
  })
  .strict();

export const codingAgentModelUsageSchema = z
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

const codingAgentContributorIdentityShape = {
  projectId: z.string(),
  projectSlug: z.string(),
  contributorLabel: z.string(),
  contributorIsProject: z.boolean(),
};

export const codingAgentPullRequestUsageRowSchema = z
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

export const codingAgentPullRequestUsageTotalsSchema = z
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

export const codingAgentPullRequestUsageSchema = z
  .object({
    pullRequest: codingAgentPullRequestIdentitySchema,
    rows: z.array(codingAgentPullRequestUsageRowSchema),
    totals: codingAgentPullRequestUsageTotalsSchema,
    modelBreakdown: z.array(codingAgentModelUsageSchema),
  })
  .strict();

export const codingAgentContributorSummarySchema = z
  .object({ ...codingAgentContributorIdentityShape, sessionsCount: z.number() })
  .strict();

export const codingAgentPersonalPullRequestRowSchema = z
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

export const codingAgentUnlinkedBranchRollupSchema = z
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

export const codingAgentPersonalPullRequestUsageSchema = z
  .object({
    rows: z.array(codingAgentPersonalPullRequestRowSchema),
    unlinked: z.array(codingAgentUnlinkedBranchRollupSchema),
  })
  .strict();

export const codingAgentPullRequestSessionFactSchema = z
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

export const codingAgentPullRequestDetailSchema = z
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

const codingAgentCallerScopeShape = {
  permittedProjectIds: z.array(z.string()),
  costProjectIds: z.array(z.string()),
  projects: z.record(z.string(), codingAgentContributorProjectSchema),
};

export const codingAgentPullRequestUsageInputSchema = z
  .object({
    ...codingAgentCallerScopeShape,
    organizationId: z.string(),
    repositoryHost: z.string(),
    repositoryFullName: z.string(),
    prNumber: z.number(),
  })
  .strict();

export const codingAgentPersonalPullRequestUsageInputSchema = z
  .object({ ...codingAgentCallerScopeShape, projectId: z.string() })
  .strict();

export type CodingAgentSession = z.infer<typeof codingAgentSessionSchema>;
export type CodingAgentSessionEvent = z.infer<typeof codingAgentSessionEventSchema>;
export type CodingAgentSessionEventRecord = z.infer<
  typeof codingAgentSessionEventRecordSchema
>;
export type CodingAgentTraceSessionRecord = z.infer<
  typeof codingAgentTraceSessionRecordSchema
>;
export type CodingAgentSessionMetricSeriesRecord = z.infer<
  typeof codingAgentSessionMetricSeriesRecordSchema
>;
export type CodingAgentSessionBranchRecord = z.infer<
  typeof codingAgentSessionBranchRecordSchema
>;
export type CodingAgentSessionCursor = z.infer<typeof codingAgentSessionCursorSchema>;
export type CodingAgentSessionEventsInput = z.infer<
  typeof codingAgentSessionEventsInputSchema
>;
export type CodingAgentSessionLookupInput = z.infer<
  typeof codingAgentSessionLookupInputSchema
>;
export type CodingAgentTraceSessionLookupInput = z.infer<
  typeof codingAgentTraceSessionLookupInputSchema
>;
export type CodingAgentRecentSessionsInput = z.infer<
  typeof codingAgentRecentSessionsInputSchema
>;
export type CodingAgentPullRequestMappingBackfillInput = z.infer<
  typeof codingAgentPullRequestMappingBackfillInputSchema
>;
export type CodingAgentUsageTotals = z.infer<typeof codingAgentUsageTotalsSchema>;
export type CodingAgentUsageTotalsInput = z.infer<
  typeof codingAgentUsageTotalsInputSchema
>;
export type CodingAgentSessionListRow = z.infer<typeof codingAgentSessionListRowSchema>;
export type CodingAgentSessionsListInput = z.infer<
  typeof codingAgentSessionsListInputSchema
>;
export type CodingAgentContributorProject = z.infer<
  typeof codingAgentContributorProjectSchema
>;
export type CodingAgentPullRequestUsageInput = z.infer<
  typeof codingAgentPullRequestUsageInputSchema
>;
export type CodingAgentPersonalPullRequestUsageInput = z.infer<
  typeof codingAgentPersonalPullRequestUsageInputSchema
>;
export type CodingAgentPullRequestUsage = z.infer<
  typeof codingAgentPullRequestUsageSchema
>;
export type CodingAgentPersonalPullRequestUsage = z.infer<
  typeof codingAgentPersonalPullRequestUsageSchema
>;
export type CodingAgentPullRequestDetail = z.infer<
  typeof codingAgentPullRequestDetailSchema
>;

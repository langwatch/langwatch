import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  type CodingAgentSessionRow,
} from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";

/**
 * A `coding_agent_sessions` row at rest: every column present, every counter
 * zero, so a test names only the handful of fields its scenario is about.
 *
 * The fold builds these from events; the pull-request suites need them seeded
 * directly, because what they exercise starts AFTER the row is committed.
 */
export function codingAgentSessionRow(
  over: Partial<CodingAgentSessionRow> & {
    tenantId: string;
    sessionId: string;
  },
): CodingAgentSessionRow {
  const now = Date.now();
  return {
    sessionKeySource: "provider",
    version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
    startedAtMs: now,

    agent: "claude_code",
    agentVersion: "2.0.0",
    traceIds: [],
    finalRequestId: "",
    userId: "",
    terminalType: "",
    entrypoint: "cli",
    parentSessionId: "",
    isFork: false,
    repositoryHost: "",
    repositoryOwner: "",
    repositoryName: "",
    gitBranch: "",
    gitBranches: [],
    gitWorktree: "",
    title: "",
    titleSource: "",

    modelCalls: 0,
    toolCalls: 0,
    subAgents: 0,
    prompts: 0,
    promptChars: 0,
    responseChars: 0,
    steps: [],

    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    models: [],
    mcpServers: [],
    mcpTools: [],

    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,

    modelCallMs: 0,
    toolMs: 0,
    ttftMsTotal: 0,
    ttftSamples: 0,
    blockedOnUserMs: 0,
    activeTimeUserSec: 0,
    activeTimeCliSec: 0,

    toolResultBytes: 0,
    toolInputBytes: 0,
    compactions: 0,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    compactionTriggers: {},
    peakContextTokens: 0,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,

    failedTools: 0,
    errorTypes: {},
    apiErrors: 0,
    rateLimited: 0,
    rateLimitEvents: 0,
    retriesExhausted: 0,
    retryMs: 0,
    attempts: 0,
    refusals: 0,
    refusalCategories: [],
    internalErrors: 0,

    toolsDenied: 0,
    toolsAborted: 0,
    permissionMode: "default",
    permissionChanges: 0,
    hooksBlocked: 0,
    hooksCancelled: 0,
    hookMs: 0,

    linesAdded: 0,
    linesRemoved: 0,
    commits: 0,
    pullRequests: 0,
    editsAccepted: 0,
    editsRejected: 0,
    languagesEdited: [],
    atMentions: 0,

    stopReason: "end_turn",
    truncated: false,

    subAgentIds: [],
    stepStartedAt: [],
    previousCallContextTokens: 0,
    metricSeries: [],
    createdAt: now,
    updatedAt: now,
    lastEventOccurredAt: now,

    ...over,
  };
}

import type {
  CodingAgentSessionRow,
  CodingAgentSessionState,
} from "../eventing/coding-agent-session.projection.ts";

/**
 * Project the fold state into the row. Every heavy thing stays out — the row
 * carries counters, bounded sets and IDs, never span/log/response contents.
 * The read-back columns (ADR-066) let `store.get()` round-trip.
 */
export function toCodingAgentSessionRow({
  state,
  tenantId,
  sessionId,
  version,
}: {
  state: CodingAgentSessionState;
  tenantId: string;
  /** The aggregate id — authoritative even when no signal spelled it out. */
  sessionId: string;
  version: string;
}): CodingAgentSessionRow {
  return {
    tenantId,
    sessionId,
    sessionKeySource: state.sessionKeySource,
    version,
    startedAtMs: state.startedAtMs,

    agent: state.agent ?? "",
    agentVersion: state.agentVersion ?? "",
    traceIds: state.traceIds,
    finalRequestId: state.finalRequestId ?? "",
    userId: state.userId ?? "",
    terminalType: state.terminalType ?? "",
    entrypoint: state.entrypoint ?? "",
    parentSessionId: state.parentSessionId ?? "",
    isFork: state.isFork,
    auxiliary: state.auxiliary,
    ...gitContextColumns(state),

    modelCalls: state.modelCalls,
    toolCalls: state.toolCalls,
    subAgents: state.subAgents,
    prompts: state.prompts,
    promptChars: state.promptChars,
    responseChars: state.responseChars,
    steps: state.steps.map((s) => [s.name, s.count, s.failed]),

    toolCounts: state.toolCounts,
    toolDurationMs: state.toolDurationMs,
    filesTouched: state.filesTouched,
    skills: state.skills,
    subAgentTypes: state.subAgentTypes,
    slashCommands: state.slashCommands,
    models: state.models,
    mcpServers: state.mcpServers,
    mcpTools: state.mcpTools,

    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheCreationTokens: state.cacheCreationTokens,
    costUsd: state.costUsd,
    agentReportedCostUsd: state.agentReportedCostUsd,
    usageByContext: Object.values(state.usageByContext),

    modelCallMs: state.modelCallMs,
    toolMs: state.toolMs,
    ttftMsTotal: state.ttftMsTotal,
    ttftSamples: state.ttftSamples,
    blockedOnUserMs: state.blockedOnUserMs,
    activeTimeUserSec: state.activeTimeUserSec,
    activeTimeCliSec: state.activeTimeCliSec,

    toolResultBytes: state.toolResultBytes,
    toolInputBytes: state.toolInputBytes,
    compactions: state.compactions,
    compactionTokensBefore: state.compactionTokensBefore,
    compactionTokensAfter: state.compactionTokensAfter,
    compactionTriggers: state.compactionTriggers,
    peakContextTokens: state.peakContextTokens,
    cacheRebuildCount: state.cacheRebuildCount,
    largestCacheRebuildTokens: state.largestCacheRebuildTokens,

    failedTools: state.failedTools,
    errorTypes: state.errorTypes,
    apiErrors: state.apiErrors,
    rateLimited: state.rateLimited,
    rateLimitEvents: state.rateLimitEvents,
    retriesExhausted: state.retriesExhausted,
    retryMs: state.retryMs,
    attempts: state.attempts,
    refusals: state.refusals,
    refusalCategories: state.refusalCategories,
    internalErrors: state.internalErrors,

    toolsDenied: state.toolsDenied,
    toolsAborted: state.toolsAborted,
    permissionMode: state.permissionMode ?? "",
    permissionChanges: state.permissionChanges,
    hooksBlocked: state.hooksBlocked,
    hooksCancelled: state.hooksCancelled,
    hookMs: state.hookMs,

    linesAdded: state.linesAdded,
    linesRemoved: state.linesRemoved,
    commits: state.commits,
    pullRequests: state.pullRequests,
    editsAccepted: state.editsAccepted,
    editsRejected: state.editsRejected,
    languagesEdited: state.languagesEdited,
    atMentions: state.atMentions,

    stopReason: state.stopReason ?? "",
    truncated: state.truncated,

    subAgentIds: state.subAgentIds,
    stepStartedAt: state.steps.map((s) => s.startedAtMs),
    previousCallContextTokens: state.previousCallContextTokens,
    metricSeries: Object.entries(state.metricSeries).map(([seriesId, fact]) => ({
      seriesId,
      metricName: fact.metricName,
      type: fact.type ?? "",
      decision: fact.decision ?? "",
      language: fact.language ?? "",
      value: fact.value,
    })),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastEventOccurredAt: state.LastEventOccurredAt,
  };
}

/**
 * The git identity and title columns (migrations 00075/00077). Empty string
 * is the honest unset here — an agent with no companion emitter reports
 * none — mapped back by `normalizeEmptyToNull`; `gitBranches` uses an empty array.
 */
function gitContextColumns(state: CodingAgentSessionState): {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  gitBranch: string;
  gitBranches: string[];
  gitWorktree: string;
  title: string;
  titleSource: string;
} {
  return {
    repositoryHost: state.repositoryHost ?? "",
    repositoryOwner: state.repositoryOwner ?? "",
    repositoryName: state.repositoryName ?? "",
    gitBranch: state.gitBranch ?? "",
    gitBranches: state.gitBranches,
    gitWorktree: state.gitWorktree ?? "",
    title: state.title ?? "",
    titleSource: state.titleSource ?? "",
  };
}

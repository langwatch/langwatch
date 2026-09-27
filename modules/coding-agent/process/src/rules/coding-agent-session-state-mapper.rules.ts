import {
  contextUsageKey,
  type MetricSeriesFact,
  type SessionTitleSource,
  sessionTitleSourceSchema,
} from "../eventing/coding-agent-session-state.projection.ts";
import type {
  CodingAgentSessionRow,
  CodingAgentSessionState,
} from "../eventing/coding-agent-session.projection.ts";

/**
 * The title-source column decodes into its union; anything else — the empty
 * default on a pre-00083 row included — reads as unset, which the fold ranks
 * as a generated title (see `withTitle`).
 */
const decodeTitleSource = (value: string): SessionTitleSource | null =>
  sessionTitleSourceSchema.safeParse(value).data ?? null;

/** An empty string in a row column reads back as "unset" (null) in state. */
const normalizeEmptyToNull = (value: string): string | null => (value === "" ? null : value);

/** Deserialize fold state from persisted row; total decoder mapping defaults for absent columns. */
export function codingAgentSessionStateFromRow(
  row: CodingAgentSessionRow,
): CodingAgentSessionState {
  const metricSeries: Record<string, MetricSeriesFact> = Object.fromEntries(
    row.metricSeries.map((unit) => [
      unit.seriesId,
      {
        metricName: unit.metricName,
        type: normalizeEmptyToNull(unit.type),
        decision: normalizeEmptyToNull(unit.decision),
        language: normalizeEmptyToNull(unit.language),
        value: unit.value,
      },
    ]),
  );

  return {
    agent: normalizeEmptyToNull(row.agent),
    sessionId: normalizeEmptyToNull(row.sessionId),
    agentVersion: normalizeEmptyToNull(row.agentVersion),
    terminalType: normalizeEmptyToNull(row.terminalType),
    entrypoint: normalizeEmptyToNull(row.entrypoint),
    finalRequestId: normalizeEmptyToNull(row.finalRequestId),
    userId: normalizeEmptyToNull(row.userId),
    parentSessionId: normalizeEmptyToNull(row.parentSessionId),
    isFork: row.isFork,
    repositoryHost: normalizeEmptyToNull(row.repositoryHost),
    repositoryOwner: normalizeEmptyToNull(row.repositoryOwner),
    repositoryName: normalizeEmptyToNull(row.repositoryName),
    gitBranch: normalizeEmptyToNull(row.gitBranch),
    gitBranches: row.gitBranches,
    gitWorktree: normalizeEmptyToNull(row.gitWorktree),
    title: normalizeEmptyToNull(row.title),
    titleSource: decodeTitleSource(row.titleSource),

    modelCalls: row.modelCalls,
    toolCalls: row.toolCalls,
    subAgents: row.subAgents,
    subAgentIds: row.subAgentIds,
    steps: row.steps.map((step, index) => ({
      name: step[0],
      count: step[1],
      failed: step[2],
      startedAtMs: row.stepStartedAt[index] ?? 0,
    })),
    prompts: row.prompts,
    promptChars: row.promptChars,
    responseChars: row.responseChars,

    toolCounts: row.toolCounts,
    toolDurationMs: row.toolDurationMs,
    filesTouched: row.filesTouched,
    skills: row.skills,
    subAgentTypes: row.subAgentTypes,
    slashCommands: row.slashCommands,
    models: row.models,
    mcpServers: row.mcpServers,
    mcpTools: row.mcpTools,

    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    costUsd: row.costUsd,
    agentReportedCostUsd: row.agentReportedCostUsd,
    usageByContext: Object.fromEntries(
      row.usageByContext.map((usage) => [contextUsageKey(usage), usage]),
    ),

    modelCallMs: row.modelCallMs,
    toolMs: row.toolMs,
    ttftMsTotal: row.ttftMsTotal,
    ttftSamples: row.ttftSamples,
    blockedOnUserMs: row.blockedOnUserMs,
    activeTimeUserSec: row.activeTimeUserSec,
    activeTimeCliSec: row.activeTimeCliSec,

    toolResultBytes: row.toolResultBytes,
    toolInputBytes: row.toolInputBytes,
    compactions: row.compactions,
    compactionTokensBefore: row.compactionTokensBefore,
    compactionTokensAfter: row.compactionTokensAfter,
    compactionTriggers: row.compactionTriggers,
    peakContextTokens: row.peakContextTokens,
    cacheRebuildCount: row.cacheRebuildCount,
    largestCacheRebuildTokens: row.largestCacheRebuildTokens,
    previousCallContextTokens: row.previousCallContextTokens,

    failedTools: row.failedTools,
    errorTypes: row.errorTypes,
    apiErrors: row.apiErrors,
    rateLimited: row.rateLimited,
    rateLimitEvents: row.rateLimitEvents,
    retriesExhausted: row.retriesExhausted,
    retryMs: row.retryMs,
    attempts: row.attempts,
    refusals: row.refusals,
    refusalCategories: row.refusalCategories,
    internalErrors: row.internalErrors,

    toolsDenied: row.toolsDenied,
    toolsAborted: row.toolsAborted,
    permissionMode: normalizeEmptyToNull(row.permissionMode),
    permissionChanges: row.permissionChanges,
    hooksBlocked: row.hooksBlocked,
    hooksCancelled: row.hooksCancelled,
    hookMs: row.hookMs,

    metricSeries,
    linesAdded: row.linesAdded,
    linesRemoved: row.linesRemoved,
    commits: row.commits,
    pullRequests: row.pullRequests,
    editsAccepted: row.editsAccepted,
    editsRejected: row.editsRejected,
    languagesEdited: row.languagesEdited,
    atMentions: row.atMentions,

    stopReason: normalizeEmptyToNull(row.stopReason),
    truncated: row.truncated,

    sessionKeySource: row.sessionKeySource,
    traceIds: row.traceIds,
    startedAtMs: row.startedAtMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    LastEventOccurredAt: row.lastEventOccurredAt,
  };
}

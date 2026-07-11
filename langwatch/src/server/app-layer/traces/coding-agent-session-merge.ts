import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";

/**
 * A coding-agent SESSION, which is not always one trace.
 *
 * Claude Code's native tracer usually groups a whole run under one traceId,
 * but a session that crosses a context compaction, a `/clear`, or simply
 * outlives the process (hits its own session limit and keeps going in a new
 * one) produces more than one trace sharing the same agent-issued
 * `sessionId`. Same shape as `CodingAgentSessionRow` — every existing
 * consumer of that type keeps working unchanged — plus the list of traces
 * this merge actually spans.
 */
export interface CodingAgentSession extends CodingAgentSessionRow {
  /** Every trace this session spans, oldest first. Length 1 for the common case. */
  traceIds: string[];
}

/**
 * Fold N trace-scoped rows into one session-scoped view.
 *
 * `rows` must be non-empty and share a `sessionId`; that invariant is the
 * caller's (the repository already filters on it). Sorted oldest-first so
 * "identity" fields (agent, version, terminal) come from the first trace and
 * "how it ended" fields (finalRequestId, stopReason) come from the last —
 * the same asymmetry `CodingAgentSessionData`'s own doc comments describe
 * for a single trace, just extended across the traces that make up the run.
 */
export function mergeCodingAgentSessionRows(
  rows: CodingAgentSessionRow[],
): CodingAgentSession {
  const sorted = [...rows].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  return {
    tenantId: first.tenantId,
    traceId: first.traceId,
    traceIds: sorted.map((r) => r.traceId),
    version: last.version,
    startedAtMs: first.startedAtMs,

    agent: first.agent,
    agentVersion: last.agentVersion,
    sessionId: first.sessionId,
    finalRequestId: last.finalRequestId,
    userId: first.userId,
    terminalType: first.terminalType,
    entrypoint: first.entrypoint,

    modelCalls: sumBy(sorted, (r) => r.modelCalls),
    toolCalls: sumBy(sorted, (r) => r.toolCalls),
    subAgents: sumBy(sorted, (r) => r.subAgents),
    prompts: sumBy(sorted, (r) => r.prompts),
    promptChars: sumBy(sorted, (r) => r.promptChars),
    responseChars: sumBy(sorted, (r) => r.responseChars),
    steps: rebatchSteps(sorted.flatMap((r) => r.steps)),

    toolCounts: mergeCountMaps(sorted.map((r) => r.toolCounts)),
    toolDurationMs: mergeCountMaps(sorted.map((r) => r.toolDurationMs)),
    filesTouched: unionDedup(sorted.map((r) => r.filesTouched)),
    skills: unionDedup(sorted.map((r) => r.skills)),
    subAgentTypes: unionDedup(sorted.map((r) => r.subAgentTypes)),
    slashCommands: unionDedup(sorted.map((r) => r.slashCommands)),
    models: unionDedup(sorted.map((r) => r.models)),
    mcpServers: unionDedup(sorted.map((r) => r.mcpServers)),
    mcpTools: unionDedup(sorted.map((r) => r.mcpTools)),

    inputTokens: sumBy(sorted, (r) => r.inputTokens),
    outputTokens: sumBy(sorted, (r) => r.outputTokens),
    cacheReadTokens: sumBy(sorted, (r) => r.cacheReadTokens),
    cacheCreationTokens: sumBy(sorted, (r) => r.cacheCreationTokens),
    costUsd: sumBy(sorted, (r) => r.costUsd),

    modelCallMs: sumBy(sorted, (r) => r.modelCallMs),
    toolMs: sumBy(sorted, (r) => r.toolMs),
    ttftMsTotal: sumBy(sorted, (r) => r.ttftMsTotal),
    ttftSamples: sumBy(sorted, (r) => r.ttftSamples),
    blockedOnUserMs: sumBy(sorted, (r) => r.blockedOnUserMs),
    activeTimeUserSec: sumBy(sorted, (r) => r.activeTimeUserSec),
    activeTimeCliSec: sumBy(sorted, (r) => r.activeTimeCliSec),

    toolResultBytes: sumBy(sorted, (r) => r.toolResultBytes),
    toolInputBytes: sumBy(sorted, (r) => r.toolInputBytes),
    compactions: sumBy(sorted, (r) => r.compactions),
    compactionTokensBefore: sumBy(sorted, (r) => r.compactionTokensBefore),
    compactionTokensAfter: sumBy(sorted, (r) => r.compactionTokensAfter),
    // Peak / largest are "how bad did it get at its worst", not "how much
    // total" — max across traces, not a sum, so a session spanning a
    // compaction doesn't report double the context it ever actually held.
    peakContextTokens: maxBy(sorted, (r) => r.peakContextTokens),
    cacheRebuildCount: sumBy(sorted, (r) => r.cacheRebuildCount),
    largestCacheRebuildTokens: maxBy(sorted, (r) => r.largestCacheRebuildTokens),

    failedTools: sumBy(sorted, (r) => r.failedTools),
    errorTypes: mergeCountMaps(sorted.map((r) => r.errorTypes)),
    apiErrors: sumBy(sorted, (r) => r.apiErrors),
    rateLimited: sumBy(sorted, (r) => r.rateLimited),
    retriesExhausted: sumBy(sorted, (r) => r.retriesExhausted),
    retryMs: sumBy(sorted, (r) => r.retryMs),
    attempts: sumBy(sorted, (r) => r.attempts),
    refusals: sumBy(sorted, (r) => r.refusals),
    refusalCategories: unionDedup(sorted.map((r) => r.refusalCategories)),
    internalErrors: sumBy(sorted, (r) => r.internalErrors),

    toolsDenied: sumBy(sorted, (r) => r.toolsDenied),
    toolsAborted: sumBy(sorted, (r) => r.toolsAborted),
    permissionMode: last.permissionMode,
    permissionChanges: sumBy(sorted, (r) => r.permissionChanges),
    hooksBlocked: sumBy(sorted, (r) => r.hooksBlocked),
    hooksCancelled: sumBy(sorted, (r) => r.hooksCancelled),
    hookMs: sumBy(sorted, (r) => r.hookMs),

    linesAdded: sumBy(sorted, (r) => r.linesAdded),
    linesRemoved: sumBy(sorted, (r) => r.linesRemoved),
    commits: sumBy(sorted, (r) => r.commits),
    pullRequests: sumBy(sorted, (r) => r.pullRequests),
    editsAccepted: sumBy(sorted, (r) => r.editsAccepted),
    editsRejected: sumBy(sorted, (r) => r.editsRejected),
    languagesEdited: unionDedup(sorted.map((r) => r.languagesEdited)),
    atMentions: sumBy(sorted, (r) => r.atMentions),

    stopReason: last.stopReason,
    truncated: last.truncated,
  };
}

function sumBy<T>(rows: T[], get: (row: T) => number): number {
  return rows.reduce((total, row) => total + get(row), 0);
}

function maxBy<T>(rows: T[], get: (row: T) => number): number {
  return rows.reduce((max, row) => Math.max(max, get(row)), 0);
}

function unionDedup(lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

function mergeCountMaps(
  maps: Record<string, number>[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

/**
 * Re-batch adjacent same-tool steps after concatenating across traces — a
 * trace boundary can otherwise split what was really one run (trace A ends
 * on `Bash`, trace B opens on `Bash`) into two adjacent steps that should
 * read as one, the same way `coding-agent-session.derivation.ts` batches
 * within a single trace.
 */
function rebatchSteps(
  steps: [string, number, boolean][],
): [string, number, boolean][] {
  const batched: [string, number, boolean][] = [];
  for (const [name, count, failed] of steps) {
    const prev = batched[batched.length - 1];
    if (prev && prev[0] === name) {
      prev[1] += count;
      prev[2] = prev[2] || failed;
    } else {
      batched.push([name, count, failed]);
    }
  }
  return batched;
}

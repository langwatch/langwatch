import type { RowMapping } from "@langwatch/clickhouse";
import {
  addToBoundedSet,
  applyLogToCodingAgentSession,
  applyMetricToCodingAgentSession,
  applySpanToCodingAgentSession,
  initCodingAgentSessionState,
} from "./coding-agent-session.derivation";
import type {
  CodingAgentSessionState,
  LogFactsContribution,
  MetricFactsContribution,
  SpanFactsContribution,
} from "./schema";
import type { CodingAgentSessionsRow, codingAgentSessionsTable } from "./table";

export { initCodingAgentSessionState };

/**
 * DEPLOY-CRITICAL PIN. `coding_agent_sessions` has live rows stamped
 * `"2026-07-28"` (`event-sourcing.old/…/codingAgentSession.foldProjection.ts:80`).
 * This fold's state is now the SAME shape those rows were written in — the
 * identity-only redesign tried earlier in this conversion was reverted (see
 * the pipeline's report) — so the pin is honest: same generation, not a
 * different shape wearing an old stamp.
 */
export const CODING_AGENT_SESSION_STATE_VERSION = "2026-07-28";

/** Identity that rides on every contribution, applied identically by all three handlers. */
function withContributionIdentity(
  state: CodingAgentSessionState,
  data: {
    sessionId: string;
    sessionKeySource: string;
    agent: string;
    traceId: string | null;
    occurredAt: number;
  },
): CodingAgentSessionState {
  return {
    ...state,
    sessionId: state.sessionId ?? data.sessionId,
    sessionKeySource: state.sessionKeySource || data.sessionKeySource,
    agent: state.agent ?? data.agent,
    traceIds:
      data.traceId !== null
        ? addToBoundedSet(state.traceIds, data.traceId)
        : state.traceIds,
    startedAtMs:
      state.startedAtMs === 0
        ? data.occurredAt
        : Math.min(state.startedAtMs, data.occurredAt),
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, data.occurredAt),
  };
}

export function applySpanFactsContributed(
  state: CodingAgentSessionState,
  data: SpanFactsContribution,
): CodingAgentSessionState {
  const next = applySpanToCodingAgentSession({
    state,
    span: {
      name: data.name,
      startTimeUnixMs: data.startTimeUnixMs,
      endTimeUnixMs: data.endTimeUnixMs,
      statusCode: data.statusCode,
      facts: data.facts,
    },
    agent: data.agent,
  });
  return withContributionIdentity(
    { ...state, ...next },
    { ...data, occurredAt: data.startTimeUnixMs },
  );
}

export function applyLogFactsContributed(
  state: CodingAgentSessionState,
  data: LogFactsContribution,
): CodingAgentSessionState {
  const next = applyLogToCodingAgentSession({
    state,
    attributes: data.facts,
    agent: data.agent,
    occurredAtMs: data.timeUnixMs,
  });
  return withContributionIdentity(
    { ...state, ...next },
    { ...data, occurredAt: data.timeUnixMs },
  );
}

export function applyMetricFactsContributed(
  state: CodingAgentSessionState,
  data: MetricFactsContribution,
): CodingAgentSessionState {
  const next = applyMetricToCodingAgentSession({
    state,
    metric: {
      seriesId: data.seriesId,
      metricName: data.metricName,
      attributes: data.attributes,
      value: data.value,
    },
  });
  return withContributionIdentity(
    { ...state, ...next },
    { ...data, traceId: null, occurredAt: data.asOfUnixMs },
  );
}

/** An empty string in a row column reads back as "unset" (null) in state. */
const nullIfEmpty = (value: string): string | null =>
  value === "" ? null : value;

/**
 * Hand-written rather than `deriveRowMapping`: `Steps`/`StepStartedAt` are a
 * split representation of one state field and `MetricSeries` re-keys an
 * object into an array, neither of which the derived 1:1 mapper can express.
 * `CreatedAt` is stamped at write time on every write (not round-tripped
 * through state), so it tracks the latest write rather than the first —
 * see this pipeline's report.
 */
export const codingAgentSessionRow: RowMapping<
  CodingAgentSessionState,
  typeof codingAgentSessionsTable.columns
> = {
  toRow(state, context): CodingAgentSessionsRow {
    return {
      TenantId: context.tenantId,
      SessionId: context.key,
      SessionKeySource: state.sessionKeySource,
      Version: context.version,
      StartedAt: new Date(state.startedAtMs),
      CreatedAt: context.writtenAt,
      UpdatedAt: context.writtenAt,

      Agent: state.agent ?? "",
      AgentVersion: state.agentVersion ?? "",
      TraceIds: state.traceIds,
      FinalRequestId: state.finalRequestId ?? "",
      UserId: state.userId ?? "",
      TerminalType: state.terminalType ?? "",
      Entrypoint: state.entrypoint ?? "",

      ModelCalls: state.modelCalls,
      ToolCalls: state.toolCalls,
      SubAgents: state.subAgents,
      Prompts: state.prompts,
      PromptChars: BigInt(state.promptChars),
      ResponseChars: BigInt(state.responseChars),
      Steps: state.steps.map(
        (s) => [s.name, s.count, s.failed] as [string, number, boolean],
      ),

      ToolCounts: new Map(Object.entries(state.toolCounts)),
      ToolDurationMs: new Map(
        Object.entries(state.toolDurationMs).map(([k, v]) => [k, BigInt(v)]),
      ),
      FilesTouched: state.filesTouched,
      Skills: state.skills,
      SubAgentTypes: state.subAgentTypes,
      SlashCommands: state.slashCommands,
      Models: state.models,
      McpServers: state.mcpServers,
      McpTools: state.mcpTools,

      InputTokens: BigInt(state.inputTokens),
      OutputTokens: BigInt(state.outputTokens),
      CacheReadTokens: BigInt(state.cacheReadTokens),
      CacheCreationTokens: BigInt(state.cacheCreationTokens),
      CostUsd: state.costUsd,

      ModelCallMs: BigInt(state.modelCallMs),
      ToolMs: BigInt(state.toolMs),
      TtftMsTotal: BigInt(state.ttftMsTotal),
      TtftSamples: state.ttftSamples,
      BlockedOnUserMs: BigInt(state.blockedOnUserMs),
      ActiveTimeUserSec: BigInt(state.activeTimeUserSec),
      ActiveTimeCliSec: BigInt(state.activeTimeCliSec),

      ToolResultBytes: BigInt(state.toolResultBytes),
      ToolInputBytes: BigInt(state.toolInputBytes),
      Compactions: state.compactions,
      CompactionTokensBefore: BigInt(state.compactionTokensBefore),
      CompactionTokensAfter: BigInt(state.compactionTokensAfter),
      PeakContextTokens: BigInt(state.peakContextTokens),
      CacheRebuildCount: state.cacheRebuildCount,
      LargestCacheRebuildTokens: BigInt(state.largestCacheRebuildTokens),

      FailedTools: state.failedTools,
      ErrorTypes: new Map(Object.entries(state.errorTypes)),
      ApiErrors: state.apiErrors,
      RateLimited: state.rateLimited,
      RetriesExhausted: state.retriesExhausted,
      RetryMs: BigInt(state.retryMs),
      Attempts: state.attempts,
      Refusals: state.refusals,
      RefusalCategories: state.refusalCategories,
      InternalErrors: state.internalErrors,

      ToolsDenied: state.toolsDenied,
      ToolsAborted: state.toolsAborted,
      PermissionMode: state.permissionMode ?? "",
      PermissionChanges: state.permissionChanges,
      HooksBlocked: state.hooksBlocked,
      HooksCancelled: state.hooksCancelled,
      HookMs: BigInt(state.hookMs),

      LinesAdded: BigInt(state.linesAdded),
      LinesRemoved: BigInt(state.linesRemoved),
      Commits: state.commits,
      PullRequests: state.pullRequests,
      EditsAccepted: state.editsAccepted,
      EditsRejected: state.editsRejected,
      LanguagesEdited: state.languagesEdited,
      AtMentions: state.atMentions,

      StopReason: state.stopReason ?? "",
      Truncated: state.truncated,

      SubAgentIds: state.subAgentIds,
      PreviousCallContextTokens: BigInt(state.previousCallContextTokens),
      StepStartedAt: state.steps.map((s) => BigInt(s.startedAtMs)),
      MetricSeries: Object.entries(state.metricSeries).map(
        ([seriesId, fact]) =>
          [
            seriesId,
            fact.metricName,
            fact.type ?? "",
            fact.decision ?? "",
            fact.language ?? "",
            fact.value,
          ] as [string, string, string, string, string, number],
      ),
      LastEventOccurredAt: new Date(state.LastEventOccurredAt),

      // Not actively deduped against by this build — see the conversion report.
      AppliedEventIds: [],

      _retention_days: context.retentionDays,
    };
  },

  fromRow(row): CodingAgentSessionState {
    const metricSeries: CodingAgentSessionState["metricSeries"] = {};
    for (const [
      seriesId,
      metricName,
      type,
      decision,
      language,
      value,
    ] of row.MetricSeries) {
      metricSeries[seriesId] = {
        metricName,
        type: nullIfEmpty(type),
        decision: nullIfEmpty(decision),
        language: nullIfEmpty(language),
        value,
      };
    }

    return {
      agent: nullIfEmpty(row.Agent),
      sessionId: nullIfEmpty(row.SessionId),
      agentVersion: nullIfEmpty(row.AgentVersion),
      terminalType: nullIfEmpty(row.TerminalType),
      entrypoint: nullIfEmpty(row.Entrypoint),
      finalRequestId: nullIfEmpty(row.FinalRequestId),
      userId: nullIfEmpty(row.UserId),
      sessionKeySource: row.SessionKeySource,
      traceIds: row.TraceIds,

      modelCalls: row.ModelCalls,
      toolCalls: row.ToolCalls,
      subAgents: row.SubAgents,
      subAgentIds: row.SubAgentIds,
      steps: row.Steps.map(([name, count, failed], index) => ({
        name,
        count,
        failed,
        startedAtMs: Number(row.StepStartedAt[index] ?? 0n),
      })),
      prompts: row.Prompts,
      promptChars: Number(row.PromptChars),
      responseChars: Number(row.ResponseChars),

      toolCounts: Object.fromEntries(row.ToolCounts),
      toolDurationMs: Object.fromEntries(
        [...row.ToolDurationMs].map(([k, v]) => [k, Number(v)]),
      ),
      filesTouched: row.FilesTouched,
      skills: row.Skills,
      subAgentTypes: row.SubAgentTypes,
      slashCommands: row.SlashCommands,
      models: row.Models,
      mcpServers: row.McpServers,
      mcpTools: row.McpTools,

      inputTokens: Number(row.InputTokens),
      outputTokens: Number(row.OutputTokens),
      cacheReadTokens: Number(row.CacheReadTokens),
      cacheCreationTokens: Number(row.CacheCreationTokens),
      costUsd: row.CostUsd,

      modelCallMs: Number(row.ModelCallMs),
      toolMs: Number(row.ToolMs),
      ttftMsTotal: Number(row.TtftMsTotal),
      ttftSamples: row.TtftSamples,
      blockedOnUserMs: Number(row.BlockedOnUserMs),
      activeTimeUserSec: Number(row.ActiveTimeUserSec),
      activeTimeCliSec: Number(row.ActiveTimeCliSec),

      toolResultBytes: Number(row.ToolResultBytes),
      toolInputBytes: Number(row.ToolInputBytes),
      compactions: row.Compactions,
      compactionTokensBefore: Number(row.CompactionTokensBefore),
      compactionTokensAfter: Number(row.CompactionTokensAfter),
      peakContextTokens: Number(row.PeakContextTokens),
      cacheRebuildCount: row.CacheRebuildCount,
      largestCacheRebuildTokens: Number(row.LargestCacheRebuildTokens),
      previousCallContextTokens: Number(row.PreviousCallContextTokens),

      failedTools: row.FailedTools,
      errorTypes: Object.fromEntries(row.ErrorTypes),
      apiErrors: row.ApiErrors,
      rateLimited: row.RateLimited,
      retriesExhausted: row.RetriesExhausted,
      retryMs: Number(row.RetryMs),
      attempts: row.Attempts,
      refusals: row.Refusals,
      refusalCategories: row.RefusalCategories,
      internalErrors: row.InternalErrors,

      toolsDenied: row.ToolsDenied,
      toolsAborted: row.ToolsAborted,
      permissionMode: nullIfEmpty(row.PermissionMode),
      permissionChanges: row.PermissionChanges,
      hooksBlocked: row.HooksBlocked,
      hooksCancelled: row.HooksCancelled,
      hookMs: Number(row.HookMs),

      metricSeries,
      linesAdded: Number(row.LinesAdded),
      linesRemoved: Number(row.LinesRemoved),
      commits: row.Commits,
      pullRequests: row.PullRequests,
      editsAccepted: row.EditsAccepted,
      editsRejected: row.EditsRejected,
      languagesEdited: row.LanguagesEdited,
      atMentions: row.AtMentions,

      stopReason: nullIfEmpty(row.StopReason),
      truncated: row.Truncated,

      startedAtMs: row.StartedAt.getTime(),
      LastEventOccurredAt: row.LastEventOccurredAt.getTime(),
    };
  },
};

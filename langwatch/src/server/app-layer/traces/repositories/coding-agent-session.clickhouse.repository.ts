import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { CodingAgentSessionRepository } from "./coding-agent-session.repository";

const TABLE_NAME = "coding_agent_sessions" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:coding-agent-session-repository",
);

/**
 * ClickHouse persistence for the coding-agent session rollup (ADR-040,
 * migration 00042).
 *
 * The UInt64 columns are serialised as STRINGS in the JSONEachRow body: JSON
 * numbers cannot safely round-trip past 2^53, and a long session's token counts
 * and byte totals are exactly the columns that get large. UInt32 / Float64 / Bool
 * fit in JSON numbers and pass through as-is.
 */
interface ClickHouseWriteRecord {
  TenantId: string;
  TraceId: string;
  Version: string;
  StartedAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  Agent: string;
  AgentVersion: string;
  SessionId: string;
  FinalRequestId: string;
  UserId: string;
  TerminalType: string;
  Entrypoint: string;

  ModelCalls: number;
  ToolCalls: number;
  SubAgents: number;
  Prompts: number;
  PromptChars: string;
  ResponseChars: string;
  Steps: [string, number, boolean][];

  ToolCounts: Record<string, number>;
  ToolDurationMs: Record<string, string>;
  FilesTouched: string[];
  Skills: string[];
  SubAgentTypes: string[];
  SlashCommands: string[];
  Models: string[];
  McpServers: string[];
  McpTools: string[];

  InputTokens: string;
  OutputTokens: string;
  CacheReadTokens: string;
  CacheCreationTokens: string;
  CostUsd: number;

  ModelCallMs: string;
  ToolMs: string;
  TtftMsTotal: string;
  TtftSamples: number;
  BlockedOnUserMs: string;
  ActiveTimeUserSec: string;
  ActiveTimeCliSec: string;

  ToolResultBytes: string;
  ToolInputBytes: string;
  Compactions: number;
  CompactionTokensBefore: string;
  CompactionTokensAfter: string;
  PeakContextTokens: string;
  CacheRebuildCount: number;
  LargestCacheRebuildTokens: string;

  FailedTools: number;
  ErrorTypes: Record<string, number>;
  ApiErrors: number;
  RateLimited: number;
  RetriesExhausted: number;
  RetryMs: string;
  Attempts: number;
  Refusals: number;
  RefusalCategories: string[];
  InternalErrors: number;

  ToolsDenied: number;
  ToolsAborted: number;
  PermissionMode: string;
  PermissionChanges: number;
  HooksBlocked: number;
  HooksCancelled: number;
  HookMs: string;

  LinesAdded: string;
  LinesRemoved: string;
  Commits: number;
  PullRequests: number;
  EditsAccepted: number;
  EditsRejected: number;
  LanguagesEdited: string[];
  AtMentions: number;

  StopReason: string;
  Truncated: boolean;

  _retention_days: number;
}

/** UInt64 columns ride as strings — see the interface docblock. */
const big = (n: number): string => String(Math.max(0, Math.round(n)));

function toRecord(
  row: CodingAgentSessionRow,
  retentionDays?: number,
): ClickHouseWriteRecord {
  const now = new Date();
  return {
    TenantId: row.tenantId,
    TraceId: row.traceId,
    Version: row.version,
    StartedAt: new Date(row.startedAtMs),
    CreatedAt: now,
    UpdatedAt: now,

    Agent: row.agent,
    AgentVersion: row.agentVersion,
    SessionId: row.sessionId,
    FinalRequestId: row.finalRequestId,
    UserId: row.userId,
    TerminalType: row.terminalType,
    Entrypoint: row.entrypoint,

    ModelCalls: row.modelCalls,
    ToolCalls: row.toolCalls,
    SubAgents: row.subAgents,
    Prompts: row.prompts,
    PromptChars: big(row.promptChars),
    ResponseChars: big(row.responseChars),
    Steps: row.steps,

    ToolCounts: row.toolCounts,
    ToolDurationMs: Object.fromEntries(
      Object.entries(row.toolDurationMs).map(([k, v]) => [k, big(v)]),
    ),
    FilesTouched: row.filesTouched,
    Skills: row.skills,
    SubAgentTypes: row.subAgentTypes,
    SlashCommands: row.slashCommands,
    Models: row.models,
    McpServers: row.mcpServers,
    McpTools: row.mcpTools,

    InputTokens: big(row.inputTokens),
    OutputTokens: big(row.outputTokens),
    CacheReadTokens: big(row.cacheReadTokens),
    CacheCreationTokens: big(row.cacheCreationTokens),
    CostUsd: row.costUsd,

    ModelCallMs: big(row.modelCallMs),
    ToolMs: big(row.toolMs),
    TtftMsTotal: big(row.ttftMsTotal),
    TtftSamples: row.ttftSamples,
    BlockedOnUserMs: big(row.blockedOnUserMs),
    ActiveTimeUserSec: big(row.activeTimeUserSec),
    ActiveTimeCliSec: big(row.activeTimeCliSec),

    ToolResultBytes: big(row.toolResultBytes),
    ToolInputBytes: big(row.toolInputBytes),
    Compactions: row.compactions,
    CompactionTokensBefore: big(row.compactionTokensBefore),
    CompactionTokensAfter: big(row.compactionTokensAfter),
    PeakContextTokens: big(row.peakContextTokens),
    CacheRebuildCount: row.cacheRebuildCount,
    LargestCacheRebuildTokens: big(row.largestCacheRebuildTokens),

    FailedTools: row.failedTools,
    ErrorTypes: row.errorTypes,
    ApiErrors: row.apiErrors,
    RateLimited: row.rateLimited,
    RetriesExhausted: row.retriesExhausted,
    RetryMs: big(row.retryMs),
    Attempts: row.attempts,
    Refusals: row.refusals,
    RefusalCategories: row.refusalCategories,
    InternalErrors: row.internalErrors,

    ToolsDenied: row.toolsDenied,
    ToolsAborted: row.toolsAborted,
    PermissionMode: row.permissionMode,
    PermissionChanges: row.permissionChanges,
    HooksBlocked: row.hooksBlocked,
    HooksCancelled: row.hooksCancelled,
    HookMs: big(row.hookMs),

    LinesAdded: big(row.linesAdded),
    LinesRemoved: big(row.linesRemoved),
    Commits: row.commits,
    PullRequests: row.pullRequests,
    EditsAccepted: row.editsAccepted,
    EditsRejected: row.editsRejected,
    LanguagesEdited: row.languagesEdited,
    AtMentions: row.atMentions,

    StopReason: row.stopReason,
    Truncated: row.truncated,

    _retention_days: retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
  };
}

export class CodingAgentSessionClickHouseRepository
  implements CodingAgentSessionRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: CodingAgentSessionRow,
    retentionDays?: number,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "CodingAgentSessionClickHouseRepository.upsert",
    );
    const client = await this.resolveClient(row.tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values: [toRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        { error, tenantId: row.tenantId, traceId: row.traceId },
        "failed to upsert coding agent session",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ row: CodingAgentSessionRow; retentionDays?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionClickHouseRepository.upsertBatch",
    );
    // A batch insert resolves ONE client, so a row from another tenant would be
    // written into this tenant's ClickHouse. Refuse rather than cross the line.
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "CodingAgentSessionClickHouseRepository.upsertBatch",
          "coding agent session batch spans multiple tenants",
          tenantId,
        );
      }
    }

    const client = await this.resolveClient(tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays }) =>
          toRecord(row, retentionDays),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        { error, tenantId, count: entries.length },
        "failed to upsert coding agent session batch",
      );
      throw error;
    }
  }

  /**
   * The session for one trace.
   *
   * Dedups with the IN-tuple pattern (max(UpdatedAt) per key) rather than FINAL:
   * the ReplacingMergeTree only physically collapses rows sharing the full sort
   * key, and `StartedAt` can shift when an earlier span arrives late, so
   * superseded rows can persist until TTL.
   *
   * `startedAtMs` prunes to a single partition. Without it this scans every
   * partition, including anything on cold storage, so callers should always pass
   * it when they have it.
   */
  async getByTraceId({
    tenantId,
    traceId,
    startedAtMs,
  }: {
    tenantId: string;
    traceId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSessionRow | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionClickHouseRepository.getByTraceId",
    );
    const client = await this.resolveClient(tenantId);

    const partitionFilter =
      startedAtMs !== undefined
        ? "AND StartedAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})"
        : "";

    const result = await client.query({
      query: `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          ${partitionFilter}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${partitionFilter}
            GROUP BY TenantId, TraceId
          )
        LIMIT 1
      `,
      query_params: {
        tenantId,
        traceId,
        // A session can run for hours, and a late span can move StartedAt
        // backwards, so widen the hint rather than pin it to the exact ms.
        ...(startedAtMs !== undefined
          ? {
              from: startedAtMs - 7 * 24 * 60 * 60 * 1000,
              to: startedAtMs + 7 * 24 * 60 * 60 * 1000,
            }
          : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const first = rows[0];
    return first ? fromRecord(first) : null;
  }
}

const asNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const asNumberMap = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          asNumber(v),
        ]),
      )
    : {};

function fromRecord(record: Record<string, unknown>): CodingAgentSessionRow {
  const steps = Array.isArray(record.Steps) ? record.Steps : [];
  return {
    tenantId: String(record.TenantId ?? ""),
    traceId: String(record.TraceId ?? ""),
    version: String(record.Version ?? ""),
    startedAtMs: new Date(String(record.StartedAt)).getTime(),

    agent: String(record.Agent ?? ""),
    agentVersion: String(record.AgentVersion ?? ""),
    sessionId: String(record.SessionId ?? ""),
    finalRequestId: String(record.FinalRequestId ?? ""),
    userId: String(record.UserId ?? ""),
    terminalType: String(record.TerminalType ?? ""),
    entrypoint: String(record.Entrypoint ?? ""),

    modelCalls: asNumber(record.ModelCalls),
    toolCalls: asNumber(record.ToolCalls),
    subAgents: asNumber(record.SubAgents),
    prompts: asNumber(record.Prompts),
    promptChars: asNumber(record.PromptChars),
    responseChars: asNumber(record.ResponseChars),
    steps: steps.map((s) => {
      const tuple = s as [string, unknown, unknown];
      return [String(tuple[0]), asNumber(tuple[1]), Boolean(tuple[2])];
    }),

    toolCounts: asNumberMap(record.ToolCounts),
    toolDurationMs: asNumberMap(record.ToolDurationMs),
    filesTouched: asStringArray(record.FilesTouched),
    skills: asStringArray(record.Skills),
    subAgentTypes: asStringArray(record.SubAgentTypes),
    slashCommands: asStringArray(record.SlashCommands),
    models: asStringArray(record.Models),
    mcpServers: asStringArray(record.McpServers),
    mcpTools: asStringArray(record.McpTools),

    inputTokens: asNumber(record.InputTokens),
    outputTokens: asNumber(record.OutputTokens),
    cacheReadTokens: asNumber(record.CacheReadTokens),
    cacheCreationTokens: asNumber(record.CacheCreationTokens),
    costUsd: asNumber(record.CostUsd),

    modelCallMs: asNumber(record.ModelCallMs),
    toolMs: asNumber(record.ToolMs),
    ttftMsTotal: asNumber(record.TtftMsTotal),
    ttftSamples: asNumber(record.TtftSamples),
    blockedOnUserMs: asNumber(record.BlockedOnUserMs),
    activeTimeUserSec: asNumber(record.ActiveTimeUserSec),
    activeTimeCliSec: asNumber(record.ActiveTimeCliSec),

    toolResultBytes: asNumber(record.ToolResultBytes),
    toolInputBytes: asNumber(record.ToolInputBytes),
    compactions: asNumber(record.Compactions),
    compactionTokensBefore: asNumber(record.CompactionTokensBefore),
    compactionTokensAfter: asNumber(record.CompactionTokensAfter),
    peakContextTokens: asNumber(record.PeakContextTokens),
    cacheRebuildCount: asNumber(record.CacheRebuildCount),
    largestCacheRebuildTokens: asNumber(record.LargestCacheRebuildTokens),

    failedTools: asNumber(record.FailedTools),
    errorTypes: asNumberMap(record.ErrorTypes),
    apiErrors: asNumber(record.ApiErrors),
    rateLimited: asNumber(record.RateLimited),
    retriesExhausted: asNumber(record.RetriesExhausted),
    retryMs: asNumber(record.RetryMs),
    attempts: asNumber(record.Attempts),
    refusals: asNumber(record.Refusals),
    refusalCategories: asStringArray(record.RefusalCategories),
    internalErrors: asNumber(record.InternalErrors),

    toolsDenied: asNumber(record.ToolsDenied),
    toolsAborted: asNumber(record.ToolsAborted),
    permissionMode: String(record.PermissionMode ?? ""),
    permissionChanges: asNumber(record.PermissionChanges),
    hooksBlocked: asNumber(record.HooksBlocked),
    hooksCancelled: asNumber(record.HooksCancelled),
    hookMs: asNumber(record.HookMs),

    linesAdded: asNumber(record.LinesAdded),
    linesRemoved: asNumber(record.LinesRemoved),
    commits: asNumber(record.Commits),
    pullRequests: asNumber(record.PullRequests),
    editsAccepted: asNumber(record.EditsAccepted),
    editsRejected: asNumber(record.EditsRejected),
    languagesEdited: asStringArray(record.LanguagesEdited),
    atMentions: asNumber(record.AtMentions),

    stopReason: String(record.StopReason ?? ""),
    truncated: Boolean(record.Truncated),
  };
}

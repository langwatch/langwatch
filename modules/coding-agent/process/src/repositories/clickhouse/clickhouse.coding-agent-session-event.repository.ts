import { type ClickHouseQueryClient, type IdBoundOptions } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, param, tenantScope } from "@langwatch/clickhouse-client/builder";
import type {
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { CodingAgentSessionEventRepository as SessionEventsRepository } from "../coding-agent-session-event.repository.ts";
import { codingAgentSessionEvents } from "./clickhouse.coding-agent-session-events.table.ts";
import { clickHouseMomentOf, type ClickHouseMoment } from "./clickhouse.mapper.ts";

const TABLE_NAME = "coding_agent_session_events" as const;

const logger = createLogger("langwatch:app-layer:coding-agent:session-events-repository");

/**
 * One (session, model, working context) group's totals. The context fields are '' for rows
 * written before the session declared where it was working (or before the stamp existed);
 * those unstamped totals are priced under the legacy whole-session rule.
 */
interface SessionModelTotalsRow {
  tenantId: string;
  sessionId: string;
  model: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  aiUnits: number;
}

/** The event kind that carries a model, its tokens and its cost. */
const MODEL_CALL_EVENT_KIND = "model_call";

interface SessionEventsCursor {
  timeUnixMs: number;
  recordId: string;
}

/**
 * A stored row, camel-cased. `tenantId` is absent by construction: the read
 * is already scoped to one tenant by the caller, so the SELECT never carries
 * the column back and the type must not claim a value the row does not hold.
 */
type CodingAgentSessionEventRow = CodingAgentSessionEvent;

interface ClickHouseWriteRecord {
  [key: string]: unknown;
  TenantId: string;
  SessionId: string;
  TimeUnixMs: ClickHouseMoment;
  RecordId: string;
  EventKind: string;
  Agent: string;
  SessionKeySource: string;
  TraceId: string;
  SpanId: string;
  PromptId: string;
  QuerySource: string;
  AgentType: string;
  EventSequence: number;
  RequestId: string;
  Model: string;
  InputTokens: number;
  OutputTokens: number;
  CacheReadTokens: number;
  CacheCreationTokens: number;
  CostUsd: number;
  DurationMs: number;
  TtftMs: number;
  Attempt: number;
  Speed: string;
  StopReason: string;
  PreTokens: number;
  PostTokens: number;
  CompactionTrigger: string;
  PrecomputeReuse: string;
  StatusCode: string;
  ErrorType: string;
  RateLimitCarrier: string;
  RetryDurationMs: number;
  ToolName: string;
  Success: string;
  Decision: string;
  DecisionSource: string;
  ToolInputBytes: number;
  ToolResultBytes: number;
  PromptChars: number;
  TotalTokens: number;
  AiUnits: number;
  RepositoryHost: string;
  RepositoryOwner: string;
  RepositoryName: string;
  Branch: string;
  UpdatedAt: ClickHouseMoment;
  _retention_days: number;
}

const events = codingAgentSessionEvents;

/** The columns a session-events page selects. */
const READ_COLUMNS = {
  SessionId: events.SessionId,
  TimeMs: fn.toUnixTimestamp64Milli(events.TimeUnixMs),
  RecordId: events.RecordId,
  EventKind: events.EventKind,
  Agent: events.Agent,
  SessionKeySource: events.SessionKeySource,
  TraceId: events.TraceId,
  SpanId: events.SpanId,
  PromptId: events.PromptId,
  QuerySource: events.QuerySource,
  AgentType: events.AgentType,
  EventSequence: events.EventSequence,
  RequestId: events.RequestId,
  Model: events.Model,
  InputTokens: events.InputTokens,
  OutputTokens: events.OutputTokens,
  CacheReadTokens: events.CacheReadTokens,
  CacheCreationTokens: events.CacheCreationTokens,
  CostUsd: events.CostUsd,
  DurationMs: events.DurationMs,
  TtftMs: events.TtftMs,
  Attempt: events.Attempt,
  Speed: events.Speed,
  StopReason: events.StopReason,
  PreTokens: events.PreTokens,
  PostTokens: events.PostTokens,
  CompactionTrigger: events.CompactionTrigger,
  PrecomputeReuse: events.PrecomputeReuse,
  StatusCode: events.StatusCode,
  ErrorType: events.ErrorType,
  RateLimitCarrier: events.RateLimitCarrier,
  RetryDurationMs: events.RetryDurationMs,
  ToolName: events.ToolName,
  Success: events.Success,
  Decision: events.Decision,
  DecisionSource: events.DecisionSource,
  ToolInputBytes: events.ToolInputBytes,
  ToolResultBytes: events.ToolResultBytes,
  PromptChars: events.PromptChars,
  TotalTokens: events.TotalTokens,
  RepositoryHost: events.RepositoryHost,
  RepositoryOwner: events.RepositoryOwner,
  RepositoryName: events.RepositoryName,
  Branch: events.Branch,
} as const;

interface ClickHouseReadRow {
  SessionId: string;
  TimeMs: number | string;
  RecordId: string;
  EventKind: string;
  Agent: string;
  SessionKeySource: string;
  TraceId: string;
  SpanId: string;
  PromptId: string;
  QuerySource: string;
  AgentType: string;
  EventSequence: number | string;
  RequestId: string;
  Model: string;
  InputTokens: number | string;
  OutputTokens: number | string;
  CacheReadTokens: number | string;
  CacheCreationTokens: number | string;
  CostUsd: number;
  DurationMs: number | string;
  TtftMs: number | string;
  Attempt: number | string;
  Speed: string;
  StopReason: string;
  PreTokens: number | string;
  PostTokens: number | string;
  CompactionTrigger: string;
  PrecomputeReuse: string;
  StatusCode: string;
  ErrorType: string;
  RateLimitCarrier: string;
  RetryDurationMs: number | string;
  ToolName: string;
  Success: string;
  Decision: string;
  DecisionSource: string;
  ToolInputBytes: number | string;
  ToolResultBytes: number | string;
  PromptChars: number | string;
  TotalTokens: number | string;
  RepositoryHost: string;
  RepositoryOwner: string;
  RepositoryName: string;
  Branch: string;
}

export class CodingAgentSessionEventsClickHouseRepository implements SessionEventsRepository {
  static create({
    clickhouse,
    defaultTraceRetentionDays,
  }: {
    clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">;
    defaultTraceRetentionDays: number;
  }): CodingAgentSessionEventsClickHouseRepository {
    return new CodingAgentSessionEventsClickHouseRepository(clickhouse, defaultTraceRetentionDays);
  }

  private constructor(
    private readonly clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">,
    private readonly defaultTraceRetentionDays: number,
  ) {}

  async ensure(records: CodingAgentSessionEventRecord[], retentionDays?: number): Promise<void> {
    const [first] = records;
    if (!first) return;

    const tenantId = first.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionEventsClickHouseRepository.ensure",
    );
    // A batch is written for ONE tenant, so a row from another would land in
    // this tenant's ClickHouse. Refuse rather than cross the line.
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "CodingAgentSessionEventsClickHouseRepository.ensure",
          message: "session events batch spans multiple tenants",
          tenantId,
        });
      }
    }

    const now = clickHouseMomentOf(nowInstant().epochMilliseconds);
    const values: ClickHouseWriteRecord[] = records.map((record) =>
      CodingAgentSessionEventsClickHouseRepository.toWriteRecord(
        record,
        now,
        retentionDays ?? this.defaultTraceRetentionDays,
      ),
    );

    try {
      await this.clickhouse.insert({
        tenantId,
        table: TABLE_NAME,
        rows: values,
        settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { error, tenantId, count: records.length },
        "failed to write coding agent session events",
      );
      throw error;
    }
  }

  async listBySessionId({
    tenantId,
    sessionId,
    kinds,
    occurredAt,
    cursor,
    limit,
  }: {
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: SessionEventsCursor;
    limit: number;
  }): Promise<{
    events: CodingAgentSessionEventRow[];
    nextCursor: SessionEventsCursor | null;
  }> {
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionEventsClickHouseRepository.findBySessionId",
    );
    // A caller's range reads as it always did, never widening; with none, the id index bounds it.
    const idBound: IdBoundOptions =
      occurredAt === undefined
        ? { fallback: "unbounded" }
        : {
            occurredAtHint: (occurredAt.fromMs + occurredAt.toMs) / 2,
            windowMs: (occurredAt.toMs - occurredAt.fromMs) / 2,
            fallback: "none",
          };
    const rows = await this.readSessionEvents({
      tenantId,
      sessionId,
      kinds,
      idBound,
      cursor,
      limit,
    });

    const events = rows.map((row) => CodingAgentSessionEventsClickHouseRepository.mapRow(row));
    const last = events[events.length - 1];
    return {
      events,
      nextCursor:
        events.length === limit && last
          ? { timeUnixMs: last.timeUnixMs, recordId: last.recordId }
          : null,
    };
  }

  private async readSessionEvents({
    tenantId,
    sessionId,
    kinds,
    idBound,
    cursor,
    limit,
  }: {
    tenantId: string;
    sessionId: string;
    kinds: string[] | undefined;
    idBound: IdBoundOptions;
    cursor: SessionEventsCursor | undefined;
    limit: number;
  }): Promise<ClickHouseReadRow[]> {
    let read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(events)
      .select(READ_COLUMNS)
      .where(({ and, eq, idBound: bound }) =>
        and(eq(events.SessionId, sessionId), bound(events.SessionId, sessionId)),
      );
    if (kinds && kinds.length > 0) read = read.where(({ oneOf }) => oneOf(events.EventKind, kinds));
    if (cursor) {
      read = read.where(({ gt }) =>
        gt(
          fn.tuple(events.TimeUnixMs, events.RecordId),
          fn.tuple(param.epochMs(cursor.timeUnixMs), param.string(cursor.recordId)),
        ),
      );
    }

    // `LIMIT 1 BY` dedups un-merged duplicate versions (same RecordId). It is
    // safe on this table because every column is a small scalar; the newest
    // UpdatedAt wins via the ORDER BY.
    const statement = read
      .orderBy(events.TimeUnixMs, "ASC")
      .orderBy(events.RecordId, "ASC")
      .orderBy(events.UpdatedAt, "DESC")
      .limitBy(1, events.TimeUnixMs, events.RecordId)
      .limit(limit)
      .build();
    const { rows } = await this.clickhouse.read({ statement, idBound });
    return rows;
  }

  async sumTokensByModelPerSession({
    tenantIds,
    sessionIds,
    fromMs,
  }: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }): Promise<SessionModelTotalsRow[]> {
    if (tenantIds.length === 0 || sessionIds.length === 0) return [];
    for (const tenantId of tenantIds) {
      EventUtils.validateTenantId(
        { tenantId },
        "CodingAgentSessionEventsClickHouseRepository.sumTokensByModelPerSession",
      );
    }

    return this.sumTokensByModel({ tenantIds, sessionIds, fromMs });
  }

  /** The per-model totals, in one statement over an organization's tenants. */
  private async sumTokensByModel({
    tenantIds,
    sessionIds,
    fromMs,
  }: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }): Promise<SessionModelTotalsRow[]> {
    // The inner scope dedups un-merged versions of one row before anything is summed, so a
    // redelivered call cannot be counted twice. `LIMIT 1 BY` is safe here for the same reason
    // it is in `findBySessionId`: every column this table holds is a small scalar.
    // ID_BOUND_SKIP: a page of sessions' totals, bounded from below by the caller's own time.
    const scope = tenantScope.set({ tenantIds });
    const calls = clickhouseRead({ scope })
      .from(events)
      .select({
        TenantId: events.TenantId,
        SessionId: events.SessionId,
        Model: events.Model,
        RepositoryHost: events.RepositoryHost,
        RepositoryOwner: events.RepositoryOwner,
        RepositoryName: events.RepositoryName,
        Branch: events.Branch,
        InputTokens: events.InputTokens,
        OutputTokens: events.OutputTokens,
        CacheReadTokens: events.CacheReadTokens,
        CacheCreationTokens: events.CacheCreationTokens,
        CostUsd: events.CostUsd,
        AiUnits: events.AiUnits,
      })
      .where(({ and, eq, gte, oneOf }) =>
        and(
          gte(events.TimeUnixMs, fromMs),
          oneOf(events.SessionId, sessionIds),
          eq(events.EventKind, MODEL_CALL_EVENT_KIND),
        ),
      )
      .orderBy(events.TenantId)
      .orderBy(events.SessionId)
      .orderBy(events.TimeUnixMs)
      .orderBy(events.RecordId)
      .orderBy(events.UpdatedAt, "DESC")
      .limitBy(1, events.TenantId, events.SessionId, events.TimeUnixMs, events.RecordId)
      .as("calls");
    const statement = clickhouseRead({ scope })
      .from(calls)
      .select({
        TenantId: calls.TenantId,
        SessionId: calls.SessionId,
        Model: calls.Model,
        RepositoryHost: calls.RepositoryHost,
        RepositoryOwner: calls.RepositoryOwner,
        RepositoryName: calls.RepositoryName,
        Branch: calls.Branch,
        SumInputTokens: fn.sum(calls.InputTokens),
        SumOutputTokens: fn.sum(calls.OutputTokens),
        SumCacheReadTokens: fn.sum(calls.CacheReadTokens),
        SumCacheCreationTokens: fn.sum(calls.CacheCreationTokens),
        SumCostUsd: fn.sum(calls.CostUsd),
        SumAiUnits: fn.sum(calls.AiUnits),
      })
      .groupBy(
        calls.TenantId,
        calls.SessionId,
        calls.Model,
        calls.RepositoryHost,
        calls.RepositoryOwner,
        calls.RepositoryName,
        calls.Branch,
      )
      .build();
    const { rows } = await this.clickhouse.read({ statement });

    return rows.map((row) => ({
      tenantId: row.TenantId,
      sessionId: row.SessionId,
      model: row.Model,
      repositoryHost: row.RepositoryHost,
      repositoryOwner: row.RepositoryOwner,
      repositoryName: row.RepositoryName,
      branch: row.Branch,
      inputTokens: Number(row.SumInputTokens),
      outputTokens: Number(row.SumOutputTokens),
      cacheReadTokens: Number(row.SumCacheReadTokens),
      cacheCreationTokens: Number(row.SumCacheCreationTokens),
      costUsd: Number(row.SumCostUsd),
      aiUnits: Number(row.SumAiUnits),
    }));
  }

  /** One row's columns, written verbatim: the table carries typed scalars only. */
  private static toWriteRecord(
    record: CodingAgentSessionEventRecord,
    writtenAt: ClickHouseMoment,
    retentionDays: number,
  ): ClickHouseWriteRecord {
    return {
      TenantId: record.tenantId,
      SessionId: record.sessionId,
      TimeUnixMs: clickHouseMomentOf(record.timeUnixMs),
      RecordId: record.recordId,
      EventKind: record.eventKind,
      Agent: record.agent,
      SessionKeySource: record.sessionKeySource,
      TraceId: record.traceId,
      SpanId: record.spanId,
      PromptId: record.promptId,
      QuerySource: record.querySource,
      AgentType: record.agentType,
      EventSequence: record.eventSequence,
      RequestId: record.requestId,
      Model: record.model,
      InputTokens: record.inputTokens,
      OutputTokens: record.outputTokens,
      CacheReadTokens: record.cacheReadTokens,
      CacheCreationTokens: record.cacheCreationTokens,
      CostUsd: record.costUsd,
      DurationMs: record.durationMs,
      TtftMs: record.ttftMs,
      Attempt: record.attempt,
      Speed: record.speed,
      StopReason: record.stopReason,
      PreTokens: record.preTokens,
      PostTokens: record.postTokens,
      CompactionTrigger: record.compactionTrigger,
      PrecomputeReuse: record.precomputeReuse,
      StatusCode: record.statusCode,
      ErrorType: record.errorType,
      RateLimitCarrier: record.rateLimitCarrier,
      RetryDurationMs: record.retryDurationMs,
      ToolName: record.toolName,
      Success: record.success,
      Decision: record.decision,
      DecisionSource: record.decisionSource,
      ToolInputBytes: record.toolInputBytes,
      ToolResultBytes: record.toolResultBytes,
      PromptChars: record.promptChars,
      TotalTokens: record.totalTokens,
      AiUnits: record.aiUnits,
      RepositoryHost: record.repositoryHost,
      RepositoryOwner: record.repositoryOwner,
      RepositoryName: record.repositoryName,
      Branch: record.branch,
      UpdatedAt: writtenAt,
      _retention_days: retentionDays,
    };
  }

  private static mapRow(row: ClickHouseReadRow): CodingAgentSessionEventRow {
    return {
      sessionId: row.SessionId,
      timeUnixMs: Number(row.TimeMs),
      recordId: row.RecordId,
      eventKind: row.EventKind,
      agent: row.Agent,
      sessionKeySource: row.SessionKeySource,
      traceId: row.TraceId,
      spanId: row.SpanId,
      promptId: row.PromptId,
      querySource: row.QuerySource,
      agentType: row.AgentType,
      eventSequence: Number(row.EventSequence),
      requestId: row.RequestId,
      model: row.Model,
      inputTokens: Number(row.InputTokens),
      outputTokens: Number(row.OutputTokens),
      cacheReadTokens: Number(row.CacheReadTokens),
      cacheCreationTokens: Number(row.CacheCreationTokens),
      costUsd: Number(row.CostUsd),
      durationMs: Number(row.DurationMs),
      ttftMs: Number(row.TtftMs),
      attempt: Number(row.Attempt),
      speed: row.Speed,
      stopReason: row.StopReason,
      preTokens: Number(row.PreTokens),
      postTokens: Number(row.PostTokens),
      compactionTrigger: row.CompactionTrigger,
      precomputeReuse: row.PrecomputeReuse,
      statusCode: row.StatusCode,
      errorType: row.ErrorType,
      rateLimitCarrier: row.RateLimitCarrier,
      retryDurationMs: Number(row.RetryDurationMs),
      toolName: row.ToolName,
      success: row.Success,
      decision: row.Decision,
      decisionSource: row.DecisionSource,
      toolInputBytes: Number(row.ToolInputBytes),
      toolResultBytes: Number(row.ToolResultBytes),
      promptChars: Number(row.PromptChars),
      totalTokens: Number(row.TotalTokens),
      repositoryHost: row.RepositoryHost,
      repositoryOwner: row.RepositoryOwner,
      repositoryName: row.RepositoryName,
      branch: row.Branch,
    };
  }

  async findSessionsByStampedBranch({
    tenantIds,
    repositoryHost,
    repositoryOwner,
    repositoryName,
    branches,
    fromMs,
  }: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }): Promise<{ tenantId: string; sessionId: string }[]> {
    if (tenantIds.length === 0 || branches.length === 0) return [];
    for (const tenantId of tenantIds) {
      EventUtils.validateTenantId(
        { tenantId },
        "CodingAgentSessionEventsClickHouseRepository.findSessionsByStampedBranch",
      );
    }

    // Distinct pairs only, so no dedup scope is needed: duplicate row
    // versions collapse under the DISTINCT. Repository identity is
    // case-folded on both sides for the same reason the session read folds
    // it — a session stores the remote's casing verbatim while the mapping
    // stores lower case. Branches stay case sensitive.
    const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(events)
      .distinct()
      .select({ TenantId: events.TenantId, SessionId: events.SessionId })
      .where(({ and, eq, gte, oneOf }) =>
        and(
          gte(events.TimeUnixMs, fromMs),
          eq(fn.lower(events.RepositoryHost), repositoryHost.toLowerCase()),
          eq(fn.lower(events.RepositoryOwner), repositoryOwner.toLowerCase()),
          eq(fn.lower(events.RepositoryName), repositoryName.toLowerCase()),
          oneOf(events.Branch, branches),
        ),
      )
      .build();
    const { rows } = await this.clickhouse.read({ statement });

    return rows.map((row) => ({
      tenantId: row.TenantId,
      sessionId: row.SessionId,
    }));
  }
}

import type {
  CodingAgentSessionEvent,
  CodingAgentSessionEventRecord,
} from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { CodingAgentSessionEventRepository as SessionEventsRepository } from "../coding-agent-session-event.repository.ts";
import { nowInstant } from "@langwatch/time";
import {
  clickHouseMomentOf,
  routingTenantOf,
  CROSS_TENANT_ROLLUP,
  type ClickHouseMoment,
} from "./clickhouse.mapper.ts";

const TABLE_NAME = "coding_agent_session_events" as const;

const logger = createLogger("langwatch:app-layer:coding-agent:session-events-repository");

/**
 * One (session, model, working context) group's totals. The context fields are '' for rows
 * written before the session declared where it was working (or before the stamp existed);
 * those unstamped totals are priced under the legacy whole-session rule.
 */
export interface SessionModelTotalsRow {
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
}

/** The event kind that carries a model, its tokens and its cost. */
export const MODEL_CALL_EVENT_KIND = "model_call";

export interface SessionEventsCursor {
  timeUnixMs: number;
  recordId: string;
}

/**
 * A stored row, camel-cased. `tenantId` is absent by construction: the read
 * is already scoped to one tenant by the caller, so the SELECT never carries
 * the column back and the type must not claim a value the row does not hold.
 */
export type CodingAgentSessionEventRow = CodingAgentSessionEvent;

interface ClickHouseWriteRecord {
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
  RepositoryHost: string;
  RepositoryOwner: string;
  RepositoryName: string;
  Branch: string;
  UpdatedAt: ClickHouseMoment;
  _retention_days: number;
}

const READ_COLUMNS = `
  SessionId, toUnixTimestamp64Milli(TimeUnixMs) AS TimeMs, RecordId, EventKind,
  Agent, SessionKeySource, TraceId, SpanId, PromptId, QuerySource, AgentType,
  EventSequence, RequestId, Model, InputTokens, OutputTokens, CacheReadTokens,
  CacheCreationTokens, CostUsd, DurationMs, TtftMs, Attempt, Speed, StopReason,
  PreTokens, PostTokens, CompactionTrigger, PrecomputeReuse, StatusCode,
  ErrorType, RateLimitCarrier, RetryDurationMs, ToolName, Success, Decision,
  DecisionSource, ToolInputBytes, ToolResultBytes, PromptChars, TotalTokens,
  RepositoryHost, RepositoryOwner, RepositoryName, Branch
`;

interface ClickHouseReadRow {
  SessionId: string;
  TimeMs: string;
  RecordId: string;
  EventKind: string;
  Agent: string;
  SessionKeySource: string;
  TraceId: string;
  SpanId: string;
  PromptId: string;
  QuerySource: string;
  AgentType: string;
  EventSequence: string;
  RequestId: string;
  Model: string;
  InputTokens: string;
  OutputTokens: string;
  CacheReadTokens: string;
  CacheCreationTokens: string;
  CostUsd: number;
  DurationMs: string;
  TtftMs: string;
  Attempt: string;
  Speed: string;
  StopReason: string;
  PreTokens: string;
  PostTokens: string;
  CompactionTrigger: string;
  PrecomputeReuse: string;
  StatusCode: string;
  ErrorType: string;
  RateLimitCarrier: string;
  RetryDurationMs: string;
  ToolName: string;
  Success: string;
  Decision: string;
  DecisionSource: string;
  ToolInputBytes: string;
  ToolResultBytes: string;
  PromptChars: string;
  TotalTokens: string;
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
    clickhouse: ClickHouseQueryClient;
    defaultTraceRetentionDays: number;
  }): CodingAgentSessionEventsClickHouseRepository {
    return new CodingAgentSessionEventsClickHouseRepository(clickhouse, defaultTraceRetentionDays);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
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
        throw new SecurityError(
          "CodingAgentSessionEventsClickHouseRepository.ensure",
          "session events batch spans multiple tenants",
          tenantId,
        );
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

  async findBySessionId({
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
    const conditions = ["TenantId = {tenantId:String}", "SessionId = {sessionId:String}"];
    if (occurredAt) {
      conditions.push(
        "TimeUnixMs BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})",
      );
    }
    if (kinds && kinds.length > 0) {
      conditions.push("EventKind IN {kinds:Array(String)}");
    }
    if (cursor) {
      conditions.push(
        "(TimeUnixMs, RecordId) > (fromUnixTimestamp64Milli({cursorTimeMs:Int64}), {cursorRecordId:String})",
      );
    }

    // `LIMIT 1 BY` dedups un-merged duplicate versions (same RecordId). It is
    // safe on this table because every column is a small scalar; the newest
    // UpdatedAt wins via the ORDER BY.
    const { rows } = await this.clickhouse.query<ClickHouseReadRow>({
      tenantId,
      table: TABLE_NAME,
      kind: "read",
      sql: `
        SELECT ${READ_COLUMNS}
        FROM ${TABLE_NAME}
        WHERE ${conditions.join(" AND ")}
        ORDER BY TimeUnixMs ASC, RecordId ASC, UpdatedAt DESC
        LIMIT 1 BY TimeUnixMs, RecordId
        LIMIT {limit:UInt32}
      `,
      params: {
        tenantId,
        sessionId,
        fromMs: occurredAt?.fromMs,
        toMs: occurredAt?.toMs,
        kinds,
        cursorTimeMs: cursor?.timeUnixMs,
        cursorRecordId: cursor?.recordId,
        limit,
      },
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
    const { rows } = await this.clickhouse.query<ClickHouseModelTotalsRow>({
      tenantId: routingTenantOf(tenantIds),
      table: TABLE_NAME,
      kind: "read",
      unscoped: CROSS_TENANT_ROLLUP,
      sql: `
        SELECT
          TenantId,
          SessionId,
          Model,
          RepositoryHost,
          RepositoryOwner,
          RepositoryName,
          Branch,
          sum(InputTokens) AS InputTokens,
          sum(OutputTokens) AS OutputTokens,
          sum(CacheReadTokens) AS CacheReadTokens,
          sum(CacheCreationTokens) AS CacheCreationTokens,
          sum(CostUsd) AS CostUsd
        FROM (
          SELECT
            TenantId,
            SessionId,
            Model,
            RepositoryHost,
            RepositoryOwner,
            RepositoryName,
            Branch,
            InputTokens,
            OutputTokens,
            CacheReadTokens,
            CacheCreationTokens,
            CostUsd
          FROM ${TABLE_NAME}
          WHERE TenantId IN {tenantIds:Array(String)}
            AND TimeUnixMs >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND SessionId IN {sessionIds:Array(String)}
            AND EventKind = {eventKind:String}
          ORDER BY TenantId, SessionId, TimeUnixMs, RecordId, UpdatedAt DESC
          LIMIT 1 BY TenantId, SessionId, TimeUnixMs, RecordId
        )
        GROUP BY TenantId, SessionId, Model, RepositoryHost, RepositoryOwner, RepositoryName, Branch
      `,
      params: {
        tenantIds,
        sessionIds,
        fromMs,
        eventKind: MODEL_CALL_EVENT_KIND,
      },
    });

    return rows.map((row) => ({
      tenantId: row.TenantId,
      sessionId: row.SessionId,
      model: row.Model,
      repositoryHost: row.RepositoryHost,
      repositoryOwner: row.RepositoryOwner,
      repositoryName: row.RepositoryName,
      branch: row.Branch,
      inputTokens: Number(row.InputTokens),
      outputTokens: Number(row.OutputTokens),
      cacheReadTokens: Number(row.CacheReadTokens),
      cacheCreationTokens: Number(row.CacheCreationTokens),
      costUsd: Number(row.CostUsd),
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

  async listSessionsByStampedBranch({
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
  }): Promise<Array<{ tenantId: string; sessionId: string }>> {
    if (tenantIds.length === 0 || branches.length === 0) return [];
    for (const tenantId of tenantIds) {
      EventUtils.validateTenantId(
        { tenantId },
        "CodingAgentSessionEventsClickHouseRepository.listSessionsByStampedBranch",
      );
    }

    // Distinct pairs only, so no dedup scope is needed: duplicate row
    // versions collapse under the DISTINCT. Repository identity is
    // case-folded on both sides for the same reason the session read folds
    // it — a session stores the remote's casing verbatim while the mapping
    // stores lower case. Branches stay case sensitive.
    const { rows } = await this.clickhouse.query<{ TenantId: string; SessionId: string }>({
      tenantId: routingTenantOf(tenantIds),
      table: TABLE_NAME,
      kind: "read",
      unscoped: CROSS_TENANT_ROLLUP,
      sql: `
          SELECT DISTINCT TenantId, SessionId
          FROM ${TABLE_NAME}
          WHERE TenantId IN {tenantIds:Array(String)}
            AND TimeUnixMs >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND lower(RepositoryHost) = {repositoryHost:String}
            AND lower(RepositoryOwner) = {repositoryOwner:String}
            AND lower(RepositoryName) = {repositoryName:String}
            AND Branch IN {branches:Array(String)}
        `,
      params: {
        tenantIds,
        fromMs,
        repositoryHost: repositoryHost.toLowerCase(),
        repositoryOwner: repositoryOwner.toLowerCase(),
        repositoryName: repositoryName.toLowerCase(),
        branches,
      },
    });

    return rows.map((row) => ({
      tenantId: row.TenantId,
      sessionId: row.SessionId,
    }));
  }
}

interface ClickHouseModelTotalsRow {
  TenantId: string;
  SessionId: string;
  Model: string;
  RepositoryHost: string;
  RepositoryOwner: string;
  RepositoryName: string;
  Branch: string;
  InputTokens: string;
  OutputTokens: string;
  CacheReadTokens: string;
  CacheCreationTokens: string;
  CostUsd: number;
}

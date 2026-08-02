import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CodingAgentSessionEventRecord } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSessionEvents.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";

const TABLE_NAME = "coding_agent_session_events" as const;

const logger = createLogger(
  "langwatch:app-layer:coding-agent:session-events-repository",
);

/**
 * Persistence for the per-call fact table (migration 00067). One row per
 * session event, identity = the canonical log record's content hash, so
 * re-delivery and replay collapse under the ReplacingMergeTree instead of
 * double-counting. Reads dedup with `LIMIT 1 BY` on the row identity —
 * acceptable here, unlike the heavy-payload tables the ClickHouse best
 * practices warn about, because every column is a small scalar.
 */
export interface CodingAgentSessionEventsRepository {
  ensure(
    records: CodingAgentSessionEventRecord[],
    retentionDays?: number,
  ): Promise<void>;

  /**
   * One session's events in time order, keyset-paginated on
   * (TimeUnixMs, RecordId). `occurredAt` bounds enable partition pruning;
   * pass the session's era whenever the caller knows it.
   */
  findBySessionId(params: {
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: SessionEventsCursor;
    limit: number;
  }): Promise<{
    events: CodingAgentSessionEventRow[];
    nextCursor: SessionEventsCursor | null;
  }>;
}

export interface SessionEventsCursor {
  timeUnixMs: number;
  recordId: string;
}

/**
 * A stored row, camel-cased. `tenantId` is absent by construction: the read
 * is already scoped to one tenant by the caller, so the SELECT never carries
 * the column back and the type must not claim a value the row does not hold.
 */
export type CodingAgentSessionEventRow = Omit<
  CodingAgentSessionEventRecord,
  "tenantId"
>;

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentSessionEventsRepository
  implements CodingAgentSessionEventsRepository
{
  async ensure(): Promise<void> {
    // no-op
  }

  async findBySessionId(): Promise<{
    events: CodingAgentSessionEventRow[];
    nextCursor: SessionEventsCursor | null;
  }> {
    return { events: [], nextCursor: null };
  }
}

interface ClickHouseWriteRecord {
  TenantId: string;
  SessionId: string;
  TimeUnixMs: Date;
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
  UpdatedAt: Date;
  _retention_days: number;
}

const READ_COLUMNS = `
  SessionId, toUnixTimestamp64Milli(TimeUnixMs) AS TimeMs, RecordId, EventKind,
  Agent, SessionKeySource, TraceId, SpanId, PromptId, QuerySource, AgentType,
  EventSequence, RequestId, Model, InputTokens, OutputTokens, CacheReadTokens,
  CacheCreationTokens, CostUsd, DurationMs, TtftMs, Attempt, Speed, StopReason,
  PreTokens, PostTokens, CompactionTrigger, PrecomputeReuse, StatusCode,
  ErrorType, RateLimitCarrier, RetryDurationMs, ToolName, Success, Decision,
  DecisionSource, ToolInputBytes, ToolResultBytes, PromptChars, TotalTokens
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
}

/** One row's columns, written verbatim: the table carries typed scalars only. */
function toWriteRecord(
  record: CodingAgentSessionEventRecord,
  writtenAt: Date,
  retentionDays?: number,
): ClickHouseWriteRecord {
  return {
    TenantId: record.tenantId,
    SessionId: record.sessionId,
    TimeUnixMs: new Date(record.timeUnixMs),
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
    UpdatedAt: writtenAt,
    _retention_days: retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
  };
}

export class CodingAgentSessionEventsClickHouseRepository
  implements CodingAgentSessionEventsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async ensure(
    records: CodingAgentSessionEventRecord[],
    retentionDays?: number,
  ): Promise<void> {
    if (records.length === 0) return;

    const tenantId = records[0]!.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionEventsClickHouseRepository.ensure",
    );
    // A batch insert resolves ONE client, so a row from another tenant would
    // be written into this tenant's ClickHouse. Refuse rather than cross the
    // line.
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "CodingAgentSessionEventsClickHouseRepository.ensure",
          "session events batch spans multiple tenants",
          tenantId,
        );
      }
    }

    const now = new Date();
    const values: ClickHouseWriteRecord[] = records.map((record) =>
      toWriteRecord(record, now, retentionDays),
    );

    const client = await this.resolveClient(tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
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
    const client = await this.resolveClient(tenantId);

    const conditions = [
      "TenantId = {tenantId:String}",
      "SessionId = {sessionId:String}",
    ];
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

    // `LIMIT 1 BY` dedups un-merged duplicate versions (same RecordId) —
    // safe on this table because every column is a small scalar; the newest
    // UpdatedAt wins via the ORDER BY.
    const result = await client.query({
      query: `
        SELECT ${READ_COLUMNS}
        FROM ${TABLE_NAME}
        WHERE ${conditions.join(" AND ")}
        ORDER BY TimeUnixMs ASC, RecordId ASC, UpdatedAt DESC
        LIMIT 1 BY TimeUnixMs, RecordId
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId,
        sessionId,
        fromMs: occurredAt?.fromMs,
        toMs: occurredAt?.toMs,
        kinds,
        cursorTimeMs: cursor?.timeUnixMs,
        cursorRecordId: cursor?.recordId,
        limit,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<ClickHouseReadRow>();
    const events = rows.map(mapRow);
    const last = events[events.length - 1];
    return {
      events,
      nextCursor:
        events.length === limit && last
          ? { timeUnixMs: last.timeUnixMs, recordId: last.recordId }
          : null,
    };
  }
}

function mapRow(row: ClickHouseReadRow): CodingAgentSessionEventRow {
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
  };
}

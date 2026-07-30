import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { z } from "zod";

const lowCardinalityString = () => ch.lowCardinality(ch.string());

/** One batched step of the session, failures marked in place (migration 00051). */
export type Step = [name: string, count: number, failed: boolean];

/** One converged metric unit of the session (migration 00053). */
export type MetricSeriesUnit = [
  seriesId: string,
  metricName: string,
  type: string,
  decision: string,
  language: string,
  value: number,
];

/**
 * An unnamed ClickHouse `Tuple` crosses the JSON wire as an array, and every
 * element type here (`String`, `UInt32`, `Bool`, `Float64`) crosses as itself,
 * so the zod schema is the whole decode and encode is the identity.
 */
const stepsColumn = (): ColumnDef<Step[]> => {
  const schema = z.array(
    z.tuple([z.string(), z.number().int().nonnegative(), z.boolean()]),
  );
  return {
    chType: "Array(Tuple(String, UInt32, Bool))",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
};

const metricSeriesColumn = (): ColumnDef<MetricSeriesUnit[]> => {
  const schema = z.array(
    z.tuple([
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.number(),
    ]),
  );
  return {
    chType: "Array(Tuple(String, String, String, String, String, Float64))",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
};

/**
 * One row per session, as migrations 00051, 00053 and 00054 deployed it —
 * every column, the time-leading sort key and the `StartedAt` anchor included.
 */
export const codingAgentSessionsTable = defineTable({
  name: "coding_agent_sessions",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "StartedAt", "SessionId"],
  partition: { by: "toYearWeek(StartedAt)", column: "StartedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "StartedAt" },
  structuralDebt: [
    {
      column: "StartedAt",
      reason:
        "migration 00051 partitions, expires and time-leads coding_agent_sessions on StartedAt, a business time that moves backwards as an earlier signal arrives late — not the platform-set acceptedAt role. It also costs the read path: with StartedAt ahead of SessionId in ORDER BY, this fold's point read on (TenantId, SessionId) is not a primary-index seek but a scan of the tenant's range. Both need one new-table-and-copy re-key; neither ORDER BY nor PARTITION BY is alterable",
    },
  ],
  columns: {
    TenantId: ch.string(),
    SessionId: ch.string(),
    SessionKeySource: lowCardinalityString(),
    /** The fold's state-version gate, not the engine's merge version. */
    Version: lowCardinalityString(),
    StartedAt: ch.occurredAt(),
    CreatedAt: ch.writtenAt(),
    UpdatedAt: ch.writtenAt(),

    Agent: lowCardinalityString(),
    AgentVersion: lowCardinalityString(),
    TraceIds: ch.array(ch.string()),
    FinalRequestId: ch.string(),
    UserId: ch.string(),
    TerminalType: lowCardinalityString(),
    Entrypoint: lowCardinalityString(),

    ModelCalls: ch.uint32(),
    ToolCalls: ch.uint32(),
    SubAgents: ch.uint32(),
    Prompts: ch.uint32(),
    PromptChars: ch.uint64(),
    ResponseChars: ch.uint64(),
    Steps: stepsColumn(),

    ToolCounts: ch.map(lowCardinalityString(), ch.uint32()),
    ToolDurationMs: ch.map(lowCardinalityString(), ch.uint64()),
    FilesTouched: ch.array(ch.string()),
    Skills: ch.array(lowCardinalityString()),
    SubAgentTypes: ch.array(lowCardinalityString()),
    SlashCommands: ch.array(lowCardinalityString()),
    Models: ch.array(lowCardinalityString()),
    McpServers: ch.array(lowCardinalityString()),
    McpTools: ch.array(lowCardinalityString()),

    InputTokens: ch.uint64(),
    OutputTokens: ch.uint64(),
    CacheReadTokens: ch.uint64(),
    CacheCreationTokens: ch.uint64(),
    CostUsd: ch.float64(),

    ModelCallMs: ch.uint64(),
    ToolMs: ch.uint64(),
    TtftMsTotal: ch.uint64(),
    TtftSamples: ch.uint32(),
    BlockedOnUserMs: ch.uint64(),
    ActiveTimeUserSec: ch.uint64(),
    ActiveTimeCliSec: ch.uint64(),

    ToolResultBytes: ch.uint64(),
    ToolInputBytes: ch.uint64(),
    Compactions: ch.uint32(),
    CompactionTokensBefore: ch.uint64(),
    CompactionTokensAfter: ch.uint64(),
    PeakContextTokens: ch.uint64(),
    CacheRebuildCount: ch.uint32(),
    LargestCacheRebuildTokens: ch.uint64(),

    FailedTools: ch.uint32(),
    ErrorTypes: ch.map(lowCardinalityString(), ch.uint32()),
    ApiErrors: ch.uint32(),
    RateLimited: ch.uint32(),
    RetriesExhausted: ch.uint32(),
    RetryMs: ch.uint64(),
    Attempts: ch.uint32(),
    Refusals: ch.uint32(),
    RefusalCategories: ch.array(lowCardinalityString()),
    InternalErrors: ch.uint32(),

    ToolsDenied: ch.uint32(),
    ToolsAborted: ch.uint32(),
    PermissionMode: lowCardinalityString(),
    PermissionChanges: ch.uint32(),
    HooksBlocked: ch.uint32(),
    HooksCancelled: ch.uint32(),
    HookMs: ch.uint64(),

    LinesAdded: ch.uint64(),
    LinesRemoved: ch.uint64(),
    Commits: ch.uint32(),
    PullRequests: ch.uint32(),
    EditsAccepted: ch.uint32(),
    EditsRejected: ch.uint32(),
    LanguagesEdited: ch.array(lowCardinalityString()),
    AtMentions: ch.uint32(),

    StopReason: lowCardinalityString(),
    Truncated: ch.boolean(),

    // Migration 00053 — read-back columns (ADR-066): close the round-trip gap
    // so this store's read() reconstructs working state without event_log.
    SubAgentIds: ch.array(ch.string()),
    PreviousCallContextTokens: ch.uint64(),
    StepStartedAt: ch.array(ch.uint64()),
    MetricSeries: metricSeriesColumn(),
    LastEventOccurredAt: ch.occurredAt(),

    // Migration 00054 — durable redelivery watermark. Carried on the row but
    // not actively deduped against by this build (see the conversion report).
    AppliedEventIds: ch.array(ch.string()),

    _retention_days: ch.uint16(),
  },
});

export type CodingAgentSessionsRow = TableRow<
  typeof codingAgentSessionsTable.columns
>;

/**
 * The `(TenantId, TraceId) -> SessionId` seam the trace drawer seeks on
 * (migration 00051) — the only place a session's contributing traces are
 * recorded. Deployed partitions on `OccurredAt`, a customer-supplied time
 * that is not frozen; `structuralDebt` names that rather than re-keying a
 * deployed, immutable table.
 */
export const codingAgentTraceSessionsTable = defineTable({
  name: "coding_agent_trace_sessions",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "TraceId"],
  partition: { by: "toYYYYMM(OccurredAt)", column: "OccurredAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "OccurredAt" },
  structuralDebt: [
    {
      column: "OccurredAt",
      reason:
        "migration 00051 partitions and expires coding_agent_trace_sessions on OccurredAt, the contributing signal's customer-supplied time — not the platform-set acceptedAt role, and immutable without a re-key migration",
    },
  ],
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    SessionId: ch.string(),
    OccurredAt: ch.occurredAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});

export type CodingAgentTraceSessionsRow = TableRow<
  typeof codingAgentTraceSessionsTable.columns
>;

/**
 * One row per converged metric unit of a session (migration 00052). Coding-
 * agent metrics carry no trace context at all, so this is how a metric-only
 * session's lines-of-code / commits / PRs / active-time exist at all.
 * Deployed partitions on `AsOf`, the newest folded point's observation time —
 * not frozen, since a later observation moves it forward.
 */
export const sessionMetricSeriesTable = defineTable({
  name: "session_metric_series",
  merge: replacing({ version: "AsOf" }),
  sortKey: ["TenantId", "SessionId", "SeriesId"],
  partition: { by: "toYYYYMM(AsOf)", column: "AsOf" },
  tenant: ["TenantId"],
  ttl: { anchor: "AsOf" },
  structuralDebt: [
    {
      column: "AsOf",
      reason:
        "migration 00052 partitions, expires and versions session_metric_series on AsOf — the newest folded point's observation time, which advances as later points arrive and is neither frozen nor platform-set",
    },
  ],
  columns: {
    TenantId: ch.string(),
    SessionId: ch.string(),
    SeriesId: ch.string(),
    MetricName: lowCardinalityString(),
    MetricUnit: lowCardinalityString(),
    Agent: lowCardinalityString(),
    Attributes: ch.map(lowCardinalityString(), ch.string()),
    Value: ch.float64(),
    DataPointCount: ch.uint32(),
    AsOf: ch.occurredAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});

export type SessionMetricSeriesRow = TableRow<
  typeof sessionMetricSeriesTable.columns
>;

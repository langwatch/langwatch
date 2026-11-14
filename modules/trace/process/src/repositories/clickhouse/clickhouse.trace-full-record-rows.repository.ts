import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  TraceNotFoundError,
  type TraceFullReadInput,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { StoredSpanRow } from "../../rules/trace-full-record.rules.ts";
import {
  TraceFullRecordRowsRepository,
  type TraceFullSummaryRow,
  type TraceFullThreadTraceRow,
} from "../trace-full-record-rows.repository.ts";
import type { TraceClickHouse } from "./clickhouse.trace-member-client.repository.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";
import { chBoolean, chNumber, chString, chStringMap } from "./stored-span-row.mapper.ts";

const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_SPANS = 10_000;
const MAX_THREAD_TRACES = 1_000;
const THREAD_ATTRIBUTE = "gen_ai.conversation.id";

const summaryRowSchema: z.ZodType<TraceFullSummaryRow> = z.looseObject({
  TraceId: chString,
  Attributes: chStringMap,
  ComputedInput: chString.nullable(),
  ComputedOutput: chString.nullable(),
  ContainsErrorStatus: chBoolean,
  ErrorMessage: chString.nullable(),
  TimeToFirstTokenMs: chNumber.nullable(),
  TotalDurationMs: chNumber.nullable(),
  TotalPromptTokenCount: chNumber.nullable(),
  TotalCompletionTokenCount: chNumber.nullable(),
  TotalCost: chNumber.nullable(),
  TokensEstimated: chBoolean,
  OccurredAtMs: chNumber,
  CreatedAtMs: chNumber,
  UpdatedAtMs: chNumber,
});

const summaryRowsSchema = z.array(summaryRowSchema);

const threadTraceRowSchema: z.ZodType<TraceFullThreadTraceRow> = z.looseObject({
  TraceId: chString,
  OccurredAtMs: chNumber,
});

const threadTraceRowsSchema = z.array(threadTraceRowSchema);

const storedSpanRowSchema: z.ZodType<StoredSpanRow> = z.looseObject({
  SpanId: chString,
  TraceId: chString,
  TenantId: chString,
  ParentSpanId: chString.nullable(),
  ParentTraceId: chString.nullable(),
  ParentIsRemote: chBoolean.nullable(),
  Sampled: chBoolean,
  StartTimeMs: chNumber,
  EndTimeMs: chNumber,
  DurationMs: chNumber,
  SpanName: chString,
  SpanKind: chNumber,
  ResourceAttributes: chStringMap,
  SpanAttributes: chStringMap,
  StatusCode: chNumber.nullable(),
  StatusMessage: chString.nullable(),
  ScopeName: chString.nullable(),
  ScopeVersion: chString.nullable(),
  Events_Timestamp: z.array(chNumber).nullable(),
  Events_Name: z.array(chString).nullable(),
  Events_Attributes: z.array(chStringMap).nullable(),
  Links_TraceId: z.array(chString).nullable(),
  Links_SpanId: z.array(chString).nullable(),
  Links_Attributes: z.array(chStringMap).nullable(),
});

const storedSpanRowsSchema = z.array(storedSpanRowSchema);

/** A full record's summary, span and thread rows, each read under the record's own tenant. */
export class ClickHouseTraceFullRecordRowsRepository extends TraceFullRecordRowsRepository {
  private constructor(
    private readonly reader: Pick<ClickHouseQueryClient, "read">,
    private readonly clients: TraceClickHouse,
  ) {
    super();
  }

  static create(options: {
    reader: Pick<ClickHouseQueryClient, "read">;
    /** The raw tenant client the span read still takes: its election is not the descriptor's. */
    clients: TraceClickHouse;
  }): ClickHouseTraceFullRecordRowsRepository {
    return new ClickHouseTraceFullRecordRowsRepository(options.reader, options.clients);
  }

  /** Bounded by the id index once ready; an id it has never seen reads unbounded, as before. */
  async getSummary(input: TraceFullReadInput): Promise<TraceFullSummaryRow> {
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(traceSummaries)
      .select({
        TraceId: traceSummaries.TraceId,
        Attributes: traceSummaries.Attributes,
        ComputedInput: traceSummaries.ComputedInput,
        ComputedOutput: traceSummaries.ComputedOutput,
        ContainsErrorStatus: traceSummaries.ContainsErrorStatus,
        ErrorMessage: traceSummaries.ErrorMessage,
        TimeToFirstTokenMs: traceSummaries.TimeToFirstTokenMs,
        TotalDurationMs: traceSummaries.TotalDurationMs,
        TotalPromptTokenCount: traceSummaries.TotalPromptTokenCount,
        TotalCompletionTokenCount: traceSummaries.TotalCompletionTokenCount,
        TotalCost: traceSummaries.TotalCost,
        TokensEstimated: traceSummaries.TokensEstimated,
        OccurredAtMs: fn.toUnixTimestamp64Milli(traceSummaries.OccurredAt),
        CreatedAtMs: fn.toUnixTimestamp64Milli(traceSummaries.CreatedAt),
        UpdatedAtMs: fn.toUnixTimestamp64Milli(traceSummaries.UpdatedAt),
      })
      .where(({ idBound }) => idBound(traceSummaries.TraceId, input.traceId))
      .latestVersion()
      .limit(1)
      .build();
    const result = await this.reader.read({
      statement,
      table: traceSummaries.$table.name,
      idBound: { occurredAtHint: input.occurredAtMs ?? null, onMiss: "unbounded" },
    });
    const summary = summaryRowsSchema.parse(result.rows)[0];
    if (!summary) throw new TraceNotFoundError(input.traceId);
    return summary;
  }

  async findThreadTraces(input: TraceFullThreadReadInput): Promise<TraceFullThreadTraceRow[]> {
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(traceSummaries)
      .select({
        TraceId: traceSummaries.TraceId,
        OccurredAtMs: fn.toUnixTimestamp64Milli(traceSummaries.OccurredAt),
      })
      .where(({ eq }) => eq(fn.mapGet(traceSummaries.Attributes, THREAD_ATTRIBUTE), input.threadId))
      // A trace keeps its thread across versions, so the election filters on it too.
      .latestVersion({ repeat: [traceSummaries.Attributes] })
      .orderBy(traceSummaries.OccurredAt, "ASC")
      .orderBy(traceSummaries.TraceId, "ASC")
      .limit(MAX_THREAD_TRACES)
      .build();
    const result = await this.reader.read({ statement, table: traceSummaries.$table.name });
    return threadTraceRowsSchema.parse(result.rows);
  }

  async findSpans(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs: number;
  }): Promise<StoredSpanRow[]> {
    const client = await this.clients.resolve(input.tenantId);
    const read = async (bounded: boolean): Promise<StoredSpanRow[]> => {
      const filter = bounded
        ? "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})"
        : "";
      const result = await client.query({
        // ID_BOUND_SKIP: bounded by the occurred time the caller found on the trace's summary.
        query: `SELECT SpanId, TraceId, TenantId, ParentSpanId, ParentTraceId, ParentIsRemote, Sampled,
          toUnixTimestamp64Milli(StartTime) AS StartTimeMs, toUnixTimestamp64Milli(EndTime) AS EndTimeMs, DurationMs,
          SpanName, SpanKind, ResourceAttributes, SpanAttributes, StatusCode, StatusMessage, ScopeName, ScopeVersion,
          arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS Events_Timestamp, \`Events.Name\` AS Events_Name,
          \`Events.Attributes\` AS Events_Attributes, \`Links.TraceId\` AS Links_TraceId, \`Links.SpanId\` AS Links_SpanId,
          \`Links.Attributes\` AS Links_Attributes FROM stored_spans WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
          ${filter} AND (TenantId, TraceId, SpanId, StartTime) IN (SELECT TenantId, TraceId, SpanId, max(StartTime) FROM stored_spans
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String} ${filter} GROUP BY TenantId, TraceId, SpanId)
          ORDER BY StartTime ASC, SpanId ASC LIMIT {limit:UInt32}`,
        query_params: {
          tenantId: input.tenantId,
          traceId: input.traceId,
          limit: MAX_SPANS,
          ...(bounded
            ? {
                fromMs: input.occurredAtMs - PARTITION_WINDOW_MS,
                toMs: input.occurredAtMs + PARTITION_WINDOW_MS,
              }
            : {}),
        },
        clickhouse_settings: { max_memory_usage: String(2 * 1024 * 1024 * 1024) },
        format: "JSONEachRow",
      });
      return storedSpanRowsSchema.parse(await result.json());
    };
    // A summary occurrence anchor is authoritative for this trace. An empty window means there
    // are no matching spans there; widening to every cold partition would make span-less reads
    // unbounded scans.
    return input.occurredAtMs > 0 ? read(true) : read(false);
  }
}

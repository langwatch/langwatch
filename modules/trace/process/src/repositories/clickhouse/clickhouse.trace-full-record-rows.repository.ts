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
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
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

/** The record's span columns, as main's full-record read named them. */
const SPAN_SELECTION = {
  SpanId: storedSpans.SpanId,
  TraceId: storedSpans.TraceId,
  TenantId: storedSpans.TenantId,
  ParentSpanId: storedSpans.ParentSpanId,
  ParentTraceId: storedSpans.ParentTraceId,
  ParentIsRemote: storedSpans.ParentIsRemote,
  Sampled: storedSpans.Sampled,
  StartTimeMs: fn.toUnixTimestamp64Milli(storedSpans.StartTime),
  EndTimeMs: fn.toUnixTimestamp64Milli(storedSpans.EndTime),
  DurationMs: storedSpans.DurationMs,
  SpanName: storedSpans.SpanName,
  SpanKind: storedSpans.SpanKind,
  ResourceAttributes: storedSpans.ResourceAttributes,
  SpanAttributes: storedSpans.SpanAttributes,
  StatusCode: storedSpans.StatusCode,
  StatusMessage: storedSpans.StatusMessage,
  ScopeName: storedSpans.ScopeName,
  ScopeVersion: storedSpans.ScopeVersion,
  Events_Timestamp: fn.arrayMap(
    (at) => fn.toUnixTimestamp64Milli(at),
    storedSpans["Events.Timestamp"],
  ),
  Events_Name: storedSpans["Events.Name"],
  Events_Attributes: storedSpans["Events.Attributes"],
  Links_TraceId: storedSpans["Links.TraceId"],
  Links_SpanId: storedSpans["Links.SpanId"],
  Links_Attributes: storedSpans["Links.Attributes"],
};

/** A full record's summary, span and thread rows, each read under the record's own tenant. */
export class ClickHouseTraceFullRecordRowsRepository extends TraceFullRecordRowsRepository {
  private constructor(private readonly reader: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create(options: {
    reader: Pick<ClickHouseQueryClient, "read">;
  }): ClickHouseTraceFullRecordRowsRepository {
    return new ClickHouseTraceFullRecordRowsRepository(options.reader);
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

  /** Bounded by the occurred time the caller found on the trace's summary, not the id index. */
  async findSpans(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs: number;
  }): Promise<StoredSpanRow[]> {
    const spans = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(storedSpans)
      .select(SPAN_SELECTION)
      .where(({ eq }) => eq(storedSpans.TraceId, input.traceId));
    // A summary occurrence anchor is authoritative for this trace. An empty window means there
    // are no matching spans there; widening to every cold partition would make span-less reads
    // unbounded scans.
    const anchored =
      input.occurredAtMs > 0
        ? spans.where(({ and, gte, lte }) =>
            and(
              gte(storedSpans.StartTime, input.occurredAtMs - PARTITION_WINDOW_MS),
              lte(storedSpans.StartTime, input.occurredAtMs + PARTITION_WINDOW_MS),
            ),
          )
        : spans;
    const statement = anchored
      // stored_spans replaces by StartTime (goose 00002), so the election keeps the engine's key.
      .latestVersion({ version: storedSpans.StartTime })
      .orderBy(storedSpans.StartTime, "ASC")
      .orderBy(storedSpans.SpanId, "ASC")
      .limit(MAX_SPANS)
      .settings({ max_memory_usage: String(2 * 1024 * 1024 * 1024) })
      .build();
    const result = await this.reader.read({ statement, table: storedSpans.$table.name });
    return storedSpanRowsSchema.parse(result.rows);
  }
}

import {
  TraceNotFoundError,
  type NormalizedSpan,
  type TraceFullRecord,
  type TraceFullReadInput,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";
import { EventUtils } from "@langwatch/eventing";

import type { TraceClickHouseClient, TraceClickHousePort } from "../../ports/clickhouse.port";
import { TraceFullRecordPort } from "../../ports/trace-full-record.port";
import type { TraceFullIoPort } from "../../ports/trace-full-io.port";
import type { TracePayloadReaderPort } from "../../ports/trace-payload-reader.port";
import {
  applyTraceFullRecordProtections,
  internalTraceFullReadProtections,
} from "../../repositories/clickhouse/trace-full-protection.mapper";
import {
  collectDroppedCategories,
  deserializeStoredAttributes,
  deserializeStoredValue,
  extractFullRecordEvents,
  mapNormalizedSpanToFullRecordSpan,
  mapStoredSpanRow,
  mapTraceMetadata,
  type StoredSpanRow,
  withoutEventReferences,
} from "./trace-full-record.mapper";

const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_SPANS = 10_000;
const MAX_THREAD_TRACES = 1_000;
const PAYLOAD_READ_CONCURRENCY = 25;

type SummaryRow = {
  TraceId: string;
  Attributes: Record<string, string>;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ContainsErrorStatus: boolean;
  ErrorMessage: string | null;
  TimeToFirstTokenMs: number | null;
  TotalDurationMs: number | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  TotalCost: number | null;
  TokensEstimated: boolean;
  OccurredAtMs: number;
  CreatedAtMs: number;
  UpdatedAtMs: number;
};

type PayloadReference = { traceId: string; eventId: string; field: string };

/** Full-record reader with package-owned normalized mapping and bounded recall. */
export class ClickHouseTraceFullRecordRepository extends TraceFullRecordPort {
  private constructor(
    private readonly clickhouse: TraceClickHousePort,
    private readonly payloads: TracePayloadReaderPort,
    private readonly io: TraceFullIoPort,
  ) {
    super();
  }

  static create(
    clickhouse: TraceClickHousePort,
    payloads: TracePayloadReaderPort,
    io: TraceFullIoPort,
  ): ClickHouseTraceFullRecordRepository {
    return new ClickHouseTraceFullRecordRepository(clickhouse, payloads, io);
  }

  async get(input: TraceFullReadInput): Promise<TraceFullRecord> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceFullRecordRepository.get",
    );
    const client = await this.clickhouse.resolve(input.tenantId);
    const summary = await this.summary(client, input);
    if (!summary) throw new TraceNotFoundError(input.traceId);

    const rows = await this.spans(client, input, input.occurredAtMs ?? summary.OccurredAtMs);
    const resolved = await this.resolveAll(input.tenantId, rows);
    const normalized = resolved.map(({ row, attributes }) => mapStoredSpanRow(row, attributes));
    const spans = normalized.map(mapNormalizedSpanToFullRecordSpan);
    const fullIo = resolved.some(({ recalled }) => recalled) ? this.io.recompute(normalized) : null;
    const droppedCategories = collectDroppedCategories(normalized);
    const events = extractFullRecordEvents({
      spans,
      projectId: input.tenantId,
      traceId: summary.TraceId,
    });

    const record: TraceFullRecord = {
      trace_id: summary.TraceId,
      project_id: input.tenantId,
      metadata: mapTraceMetadata(summary.Attributes),
      timestamps: {
        started_at: summary.OccurredAtMs,
        inserted_at: summary.CreatedAtMs,
        updated_at: summary.UpdatedAtMs,
      },
      input: fullIo?.input ?? summaryContent(summary.ComputedInput),
      output: fullIo?.output ?? summaryContent(summary.ComputedOutput),
      ...(summary.ContainsErrorStatus
        ? {
            error: {
              has_error: true,
              message: summary.ErrorMessage ?? "Unknown error",
              stacktrace: [],
            },
          }
        : {}),
      metrics: traceMetrics(summary),
      spans,
      ...(events.length > 0 ? { events } : {}),
      ...(droppedCategories.length > 0 ? { privacy: { droppedCategories } } : {}),
    };
    return applyTraceFullRecordProtections(record, internalTraceFullReadProtections);
  }

  async getThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceFullRecordRepository.getThread",
    );
    const client = await this.clickhouse.resolve(input.tenantId);
    const result = await client.query<{ TraceId: string; OccurredAtMs: number }>({
      query: `SELECT TraceId, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs FROM trace_summaries
        WHERE TenantId = {tenantId:String} AND Attributes['gen_ai.conversation.id'] = {threadId:String}
        AND (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries
          WHERE TenantId = {tenantId:String} AND Attributes['gen_ai.conversation.id'] = {threadId:String} GROUP BY TenantId, TraceId)
        ORDER BY OccurredAt ASC, TraceId ASC LIMIT {limit:UInt32}`,
      query_params: {
        tenantId: input.tenantId,
        threadId: input.threadId,
        limit: MAX_THREAD_TRACES,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ TraceId: string; OccurredAtMs: number }>();
    const records = await mapWithConcurrency(rows, PAYLOAD_READ_CONCURRENCY, (row) =>
      this.get({ tenantId: input.tenantId, traceId: row.TraceId, occurredAtMs: row.OccurredAtMs }),
    );
    return records.sort(
      (left, right) =>
        left.timestamps.started_at - right.timestamps.started_at ||
        left.trace_id.localeCompare(right.trace_id),
    );
  }

  private async summary(
    client: TraceClickHouseClient,
    input: TraceFullReadInput,
  ): Promise<SummaryRow | null> {
    const result = await client.query<SummaryRow>({
      query: `SELECT TraceId, Attributes, ComputedInput, ComputedOutput, ContainsErrorStatus, ErrorMessage,
        TimeToFirstTokenMs, TotalDurationMs, TotalPromptTokenCount, TotalCompletionTokenCount, TotalCost, TokensEstimated,
        toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs, toUnixTimestamp64Milli(CreatedAt) AS CreatedAtMs,
        toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAtMs FROM trace_summaries WHERE TenantId = {tenantId:String}
        AND TraceId = {traceId:String} AND (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt)
          FROM trace_summaries WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String} GROUP BY TenantId, TraceId) LIMIT 1`,
      query_params: { tenantId: input.tenantId, traceId: input.traceId },
      format: "JSONEachRow",
    });
    return (await result.json<SummaryRow>())[0] ?? null;
  }

  private async spans(
    client: TraceClickHouseClient,
    input: TraceFullReadInput,
    occurredAtMs: number,
  ): Promise<StoredSpanRow[]> {
    const read = async (bounded: boolean): Promise<StoredSpanRow[]> => {
      const filter = bounded
        ? "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})"
        : "";
      const result = await client.query<StoredSpanRow>({
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
                fromMs: occurredAtMs - PARTITION_WINDOW_MS,
                toMs: occurredAtMs + PARTITION_WINDOW_MS,
              }
            : {}),
        },
        clickhouse_settings: { max_memory_usage: String(2 * 1024 * 1024 * 1024) },
        format: "JSONEachRow",
      });
      return result.json<StoredSpanRow>();
    };
    // A summary occurrence anchor is authoritative for this trace. An empty
    // window means there are no matching spans there; widening to every cold
    // partition would turn ordinary span-less reads into unbounded scans.
    return occurredAtMs > 0 ? read(true) : read(false);
  }

  private async resolveAll(
    tenantId: string,
    rows: StoredSpanRow[],
  ): Promise<
    Array<{
      row: StoredSpanRow;
      attributes: NormalizedSpan["spanAttributes"];
      recalled: boolean;
    }>
  > {
    const plans = rows.map((row) => ({
      row,
      original: deserializeStoredAttributes(row.SpanAttributes),
    }));
    const reads = new Map<string, PayloadReference>();
    for (const plan of plans) {
      for (const reference of eventReferences(plan.original)) {
        reads.set(referenceKey(plan.row.TraceId, reference), {
          traceId: plan.row.TraceId,
          eventId: reference.eventId,
          field: reference.field,
        });
      }
    }
    const values = new Map<string, string | null>();
    await mapWithConcurrency(
      [...reads.entries()],
      PAYLOAD_READ_CONCURRENCY,
      async ([key, reference]) => {
        try {
          values.set(key, await this.payloads.tryRead({ tenantId, ...reference }));
        } catch {
          values.set(key, null);
        }
      },
    );

    return plans.map(({ row, original }) => {
      const attributes = withoutEventReferences(original);
      let recalled = false;
      for (const reference of eventReferences(original)) {
        const value = values.get(referenceKey(row.TraceId, reference));
        if (value !== null && value !== void 0) {
          attributes[reference.attrKey] = deserializeStoredValue(value);
          recalled = true;
        }
      }
      return { row, attributes, recalled };
    });
  }
}

function eventReferences(
  attributes: NormalizedSpan["spanAttributes"],
): Array<{ attrKey: string; eventId: string; field: string }> {
  const prefix = "langwatch.reserved.eventref.";
  return Object.entries(attributes).flatMap(([key, value]) => {
    if (!key.startsWith(prefix)) return [];
    const decoded = typeof value === "string" ? parseReference(value) : value;
    if (!isReference(decoded)) return [];
    return [{ attrKey: key.slice(prefix.length), eventId: decoded.eventId, field: decoded.field }];
  });
}

function parseReference(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isReference(value: unknown): value is { eventId: string; field: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const eventId = ownString(value, "eventId");
  const field = ownString(value, "field");
  return eventId !== null && eventId.length > 0 && field !== null && field.length > 0;
}

function ownString(value: object, key: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return typeof descriptor?.value === "string" ? descriptor.value : null;
}

function referenceKey(traceId: string, reference: { eventId: string; field: string }): string {
  return `${traceId}\u0000${reference.eventId}\u0000${reference.field}`;
}

function summaryContent(value: string | null): { type: string; value: string } | null {
  return value === null ? null : { type: "text", value };
}

function traceMetrics(summary: SummaryRow): Record<string, number | boolean | null> {
  return {
    first_token_ms: summary.TimeToFirstTokenMs,
    total_time_ms: summary.TotalDurationMs,
    prompt_tokens: summary.TotalPromptTokenCount,
    completion_tokens: summary.TotalCompletionTokenCount,
    total_cost: summary.TotalCost,
    tokens_estimated: summary.TokensEstimated,
  };
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = new Map<number, Output>();
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++;
      const input = inputs[index];
      if (input === void 0) continue;
      output.set(index, await operation(input));
    }
  });
  await Promise.all(workers);
  return inputs.map((_input, index) => {
    for (const [completedIndex, result] of output) {
      if (completedIndex === index) return result;
    }
    throw new Error(`Concurrent Trace read did not produce result ${index}`);
  });
}

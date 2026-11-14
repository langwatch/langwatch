import { EventUtils } from "@langwatch/eventing";
import {
  EVENTREF_ATTR_PREFIX,
  traceFullRecordSchema,
  type NormalizedSpan,
  type TraceFullRecord,
  type TraceFullReadInput,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";

import {
  applyTraceFullReadProtections,
  internalTraceFullReadProtections,
} from "../../features/read/rules/trace-full-protection.rules.ts";
import type { TraceFullIo } from "../../features/read/services/trace-read-full-io.service.ts";
import {
  type StoredSpanRow,
  collectDroppedCategories,
  deserializeStoredAttributes,
  deserializeStoredValue,
  extractFullRecordEvents,
  mapNormalizedSpanToFullRecordSpan,
  mapStoredSpanRow,
  mapTraceMetadata,
  withoutEventReferences,
} from "../../rules/trace-full-record.rules.ts";
import { offloadedFieldKey } from "../../rules/trace-offload-recall.rules.ts";
import type {
  TraceFullRecordRowsRepository,
  TraceFullSummaryRow,
} from "../trace-full-record-rows.repository.ts";
import { TraceFullRecordRepository } from "../trace-full-record.repository.ts";
import type { TracePayloadReaderRepository } from "../trace-payload-reader.repository.ts";

const PAYLOAD_READ_CONCURRENCY = 25;

/** Assembles a full record from its summary, span and thread rows, with bounded payload recall. */
export class ClickHouseTraceFullRecordRepository extends TraceFullRecordRepository {
  private constructor(
    private readonly rows: TraceFullRecordRowsRepository,
    private readonly payloads: TracePayloadReaderRepository,
    private readonly io: TraceFullIo,
  ) {
    super();
  }

  static create(
    rows: TraceFullRecordRowsRepository,
    payloads: TracePayloadReaderRepository,
    io: TraceFullIo,
  ): ClickHouseTraceFullRecordRepository {
    return new ClickHouseTraceFullRecordRepository(rows, payloads, io);
  }

  async get(input: TraceFullReadInput): Promise<TraceFullRecord> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceFullRecordRepository.get",
    );
    const summary = await this.rows.getSummary(input);
    const rows = await this.rows.findSpans({
      tenantId: input.tenantId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs ?? summary.OccurredAtMs,
    });
    const resolved = await this.resolveAll(input.tenantId, rows);
    const normalized = resolved.map(({ row, attributes }) => mapStoredSpanRow(row, attributes));
    const spans = normalized.map((span) => mapNormalizedSpanToFullRecordSpan(span));
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
      input:
        fullIo?.input ?? ClickHouseTraceFullRecordRepository.summaryContent(summary.ComputedInput),
      output:
        fullIo?.output ??
        ClickHouseTraceFullRecordRepository.summaryContent(summary.ComputedOutput),
      ...(summary.ContainsErrorStatus
        ? {
            error: {
              has_error: true,
              message: summary.ErrorMessage ?? "Unknown error",
              stacktrace: [],
            },
          }
        : {}),
      metrics: ClickHouseTraceFullRecordRepository.traceMetrics(summary),
      spans,
      ...(events.length > 0 ? { events } : {}),
      ...(droppedCategories.length > 0 ? { privacy: { droppedCategories } } : {}),
    };
    return traceFullRecordSchema.parse(
      applyTraceFullReadProtections(record, internalTraceFullReadProtections),
    );
  }

  async findThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceFullRecordRepository.findThread",
    );
    const rows = await this.rows.findThreadTraces(input);
    const records = await ClickHouseTraceFullRecordRepository.mapWithConcurrency(
      rows,
      PAYLOAD_READ_CONCURRENCY,
      (row) =>
        this.get({
          tenantId: input.tenantId,
          traceId: row.TraceId,
          occurredAtMs: row.OccurredAtMs,
        }),
    );
    return records.toSorted(
      (left, right) =>
        left.timestamps.started_at - right.timestamps.started_at ||
        left.trace_id.localeCompare(right.trace_id),
    );
  }

  private async resolveAll(
    tenantId: string,
    rows: StoredSpanRow[],
  ): Promise<
    {
      row: StoredSpanRow;
      attributes: NormalizedSpan["spanAttributes"];
      recalled: boolean;
    }[]
  > {
    const plans = rows.map((row) => ({
      row,
      original: deserializeStoredAttributes(row.SpanAttributes),
    }));
    const references = plans.flatMap(({ row, original }) =>
      ClickHouseTraceFullRecordRepository.eventReferences(original).map(({ eventId, field }) => ({
        traceId: row.TraceId,
        eventId,
        field,
      })),
    );
    const outcomes = await this.payloads.recall({
      tenantId,
      references,
      concurrency: PAYLOAD_READ_CONCURRENCY,
    });

    return plans.map(({ row, original }) => {
      const attributes = withoutEventReferences(original);
      let recalled = false;
      for (const reference of ClickHouseTraceFullRecordRepository.eventReferences(original)) {
        const outcome = outcomes.get(offloadedFieldKey({ traceId: row.TraceId, ...reference }));
        if (outcome?.ok) {
          attributes[reference.attrKey] = deserializeStoredValue(outcome.value);
          recalled = true;
        }
      }
      return { row, attributes, recalled };
    });
  }

  private static eventReferences(
    attributes: NormalizedSpan["spanAttributes"],
  ): { attrKey: string; eventId: string; field: string }[] {
    const prefix = EVENTREF_ATTR_PREFIX;
    return Object.entries(attributes).flatMap(([key, value]) => {
      if (!key.startsWith(prefix)) return [];
      const decoded =
        typeof value === "string"
          ? ClickHouseTraceFullRecordRepository.parseReference(value)
          : value;
      if (!ClickHouseTraceFullRecordRepository.isReference(decoded)) return [];
      return [
        { attrKey: key.slice(prefix.length), eventId: decoded.eventId, field: decoded.field },
      ];
    });
  }

  private static parseReference(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private static isReference(value: unknown): value is { eventId: string; field: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const eventId = ClickHouseTraceFullRecordRepository.ownString(value, "eventId");
    const field = ClickHouseTraceFullRecordRepository.ownString(value, "field");
    return eventId !== null && eventId.length > 0 && field !== null && field.length > 0;
  }

  private static ownString(value: object, key: string): string | null {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof descriptor?.value === "string" ? descriptor.value : null;
  }

  private static summaryContent(value: string | null): { type: string; value: string } | null {
    return value === null ? null : { type: "text", value };
  }

  private static traceMetrics(
    summary: TraceFullSummaryRow,
  ): Record<string, number | boolean | null> {
    return {
      first_token_ms: summary.TimeToFirstTokenMs,
      total_time_ms: summary.TotalDurationMs,
      prompt_tokens: summary.TotalPromptTokenCount,
      completion_tokens: summary.TotalCompletionTokenCount,
      total_cost: summary.TotalCost,
      tokens_estimated: summary.TokensEstimated,
    };
  }

  private static async mapWithConcurrency<Input, Output>(
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
}

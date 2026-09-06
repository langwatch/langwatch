import { z } from "zod";

/**
 * The per-span read models the trace drawer and trace list render —
 * projections of `stored_spans`, not the stored span itself, each the slim
 * shape one surface reads.
 */

/** One event name a trace recorded, with how often and when it first fired. */
export const traceEventNameCountSchema = z.object({
  name: z.string(),
  count: z.number(),
  /** Epoch ms of the earliest event under this name — the display order. */
  firstTimestamp: z.number(),
});

export type TraceEventNameCount = z.infer<typeof traceEventNameCountSchema>;

/** A trace's events as the list renders them: named groups plus true totals. */
export const traceEventRollupSchema = z.object({
  /**
   * Ordered by first occurrence, at most `MAX_EVENT_NAMES_PER_TRACE` entries.
   * Shorter than `distinctCount` when the trim bit.
   */
  names: z.array(traceEventNameCountSchema),
  /** Every event the trace recorded, counting names beyond the trim. */
  totalCount: z.number(),
  /** Distinct event names the trace recorded, counting those beyond the trim. */
  distinctCount: z.number(),
});

export type TraceEventRollup = z.infer<typeof traceEventRollupSchema>;

export interface SpanSummaryRow {
  spanId: string;
  parentSpanId: string | null;
  spanName: string;
  durationMs: number;
  statusCode: number | null;
  spanType: string | null;
  /** Tool display name (`gen_ai.tool.name` ?? `tool_name`), tool spans only. */
  toolName: string | null;
  /** Claude model-call join key (`request_id`), llm_request spans only. */
  requestId: string | null;
  /** Claude prompt-pairing scope (`query_source`). */
  querySource: string | null;
  /** Tool-call join key (`tool_use_id` ?? `gen_ai.tool.call.id`). */
  toolUseId: string | null;
  model: string | null;
  /** USD cost: SDK-reported, else computed from tokens × pricing at read time. */
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  startTimeMs: number;
  /** Row version, bumped on re-projection. The live delta poll keys off this, not `startTimeMs`. */
  updatedAtMs: number;
}

/**
 * Raw OTel resource + scope info per span. The mapping to `Span` drops
 * `resourceAttributes` and `instrumentationScope`, so consumers (drawer
 * metadata, scope chip) need this dedicated read path.
 */
export interface SpanResourceInfo {
  spanId: string;
  parentSpanId: string | null;
  startTimeMs: number;
  resourceAttributes: Record<string, string>;
  scopeName: string | null;
  scopeVersion: string | null;
}

/**
 * One trace-correlated log record as returned to the frontend raw-log
 * inspector. The `traceId` is implied by the query; `attributes` carries the
 * emitter's event payload (`body`, `event.name`, `request_id`, `cost_usd`, …).
 */
export const traceLogRecordDtoSchema = z.object({
  spanId: z.string(),
  timeUnixMs: z.number(),
  body: z.string(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
  scopeName: z.string(),
  scopeVersion: z.string().nullable(),
  /** True when content was withheld (body + content attrs); mirrors span `inputRedacted`/`outputRedacted`. */
  bodyRedacted: z.boolean().optional(),
  /** Audience label naming who CAN see the withheld content, when restricted. */
  bodyVisibleTo: z.string().nullable().optional(),
});

export type TraceLogRecordDto = z.infer<typeof traceLogRecordDtoSchema>;

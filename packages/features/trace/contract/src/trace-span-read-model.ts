import { z } from "zod";

/**
 * The per-span read models the trace drawer and the trace list render.
 *
 * These rows are projections of `stored_spans`, not the stored span itself:
 * each one is the slim shape a particular surface reads, and each one is
 * published by the trace transport. They live in the contract for the same
 * reason as `TraceListItem` — a payload type declared in the application
 * would narrow to its declared constraint for every client once the transport
 * moved into a package.
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
  /**
   * USD cost: `gen_ai.usage.cost` when the SDK reported one, otherwise
   * computed at read time from token counts × model pricing (same
   * cascade the trace-level fold uses). Null when neither yields a
   * value — most ingest paths only emit token counts, so without the
   * computed fallback the waterfall never had a per-span cost to show.
   */
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  startTimeMs: number;
  /**
   * Row version, not span timing: bumped every time a span is re-projected.
   * The live delta poll keys off this rather than `startTimeMs`, because a
   * span updated in place (end time, duration, status, cost) keeps its start
   * time and a start-keyed poll could never see it.
   */
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
  /**
   * True when this record carried captured content the viewer may not see, so
   * the content was withheld — the top-level body, the per-event content
   * attributes (`prompt` / `response` / `body`), and the ingest-derived
   * `langwatch.gen_ai.*` content attrs. The UI renders the redacted
   * placeholder, mirroring the span endpoints' `inputRedacted` /
   * `outputRedacted`.
   */
  bodyRedacted: z.boolean().optional(),
  /** Audience label naming who CAN see the withheld content, when restricted. */
  bodyVisibleTo: z.string().nullable().optional(),
});

export type TraceLogRecordDto = z.infer<typeof traceLogRecordDtoSchema>;

/**
 * Read-time Claude Code log-to-span content enrichment. Real `llm_request` spans carry tokens but
 * no message content, which lives only in OTLP log records, so every read path wanting whole spans
 * joins the two server-side. Cost is not joined here: it is computed at ingest and stored once.
 */
import { ClaudeCodeSpanEnrichmentService } from "./claude-code-span-enrichment.service";
import type { Logger } from "@langwatch/observability";
import { contentAttrKeys, type CodingAgentService } from "@langwatch/coding-agent-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { capPayloadString, type TraceApp } from "@langwatch/trace-server";
import type { Span } from "@langwatch/trace-contract";
import {
  type ClaudeContentLog,
  type ClaudeSpanRef,
} from "../rules/claude-code-message-index.rules";
import {
  type ClaudeToolLog,
  type ClaudeToolSpanRef,
} from "../rules/claude-code-tool-enrichment.rules";
import { DERIVED_ATTRS } from "./trace-log-content-derivation.service";
import type { SpanSummaryRow } from "@langwatch/trace-contract";
import {
  CLAUDE_SPAN_NAME_PREFIX,
  isInteractionSpan,
  nonEmptyOrNull,
  parseBoolAttr,
  parseNumberAttr,
  readStringParam,
  SPAN_QUERY_SOURCE_KEY,
  SPAN_REQUEST_ID_KEY,
  SPAN_USER_PROMPT_KEY,
  spanToolUseId,
} from "../rules/claude-code-span-keys.rules";

/**
 * The trace-log read this join issues for itself, and the row it answers with. Taken off the trace
 * application rather than this process's storage service, because that is what both read paths
 * hand in. The storage service still satisfies it, its row being this one plus a traceId.
 */
export type TraceLogRecordReader = TraceApp["logRecords"];
type TraceLogRecordReadRow = Awaited<ReturnType<TraceLogRecordReader["getLogsByTraceId"]>>[number];

/**
 * The trace-origin value Claude Code (and other coding assistants) carry. Only
 * traces of this origin pay for the log read + enrichment; every other trace
 * short-circuits before any work.
 */
export const CODING_AGENT_ORIGIN = "coding_agent";

/**
 * OTLP log attribute keys the metadata attributes carry, all string-valued in ClickHouse. Content
 * keys live beside the API's redaction, reading from the same table, so a key surfaced here can
 * never be one the gate does not know.
 */
const EVENT_NAME_ATTR = "event.name";
const REQUEST_ID_ATTR = "request_id";
const QUERY_SOURCE_ATTR = "query_source";
const TOOL_DECISION_EVENT = "tool_decision";
const TOOL_RESULT_EVENT = "tool_result";
const TOOL_USE_ID_ATTR = "tool_use_id";
const TOOL_NAME_ATTR = "tool_name";
const TOOL_PARAMETERS_ATTR = "tool_parameters";
const TOOL_INPUT_ATTR = "tool_input";
const DECISION_ATTR = "decision";
const DECISION_SOURCE_ATTR = "source";
const RESULT_DECISION_SOURCE_ATTR = "decision_source";
const SUCCESS_ATTR = "success";
const DURATION_MS_ATTR = "duration_ms";
const RESULT_SIZE_ATTR = "tool_result_size_bytes";

/** The attribute carrying the event's content payload, per event name. */
function readContentBody(
  eventName: string,
  attrs: Record<string, string>,
  codingAgents?: CodingAgentService,
): string | null {
  for (const key of codingAgents?.contentAttrKeys(eventName) ?? contentAttrKeys(eventName)) {
    const value = nonEmptyOrNull(attrs[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export class ClaudeCodeLogEnrichmentService {
  static create(): ClaudeCodeLogEnrichmentService {
    return new ClaudeCodeLogEnrichmentService();
  }

  /**
   * Maps the trace's model-call spans to {@link ClaudeSpanRef}. Only spans carrying a request_id
   * participate, since those are what logs join to and restricting the set keeps positional input
   * pairing aligned to model calls. Sorted by start time so positional order matches call order.
   */
  static mapSpansToClaudeRefs(spans: Span[]): ClaudeSpanRef[] {
    return spans
      .filter((span) => readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null)
      .slice()
      .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
      .map((span) => ({
        spanId: span.span_id,
        requestId: readStringParam(span.params, SPAN_REQUEST_ID_KEY),
        querySource: readStringParam(span.params, SPAN_QUERY_SOURCE_KEY),
      }));
  }

  /**
   * True when the trace carries Claude Code model-call spans — i.e. at least one
   * span has a `request_id` for the logs to join onto.
   */
  static hasClaudeModelCallSpans(spans: Span[]): boolean {
    return spans.some((span) => readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null);
  }

  /**
   * True when the trace has any span the join could add content to: a model call, a tool call, or
   * the turn's interaction root. Every caller runs this gate before reading logs, so a trace with
   * nothing to enrich never touches the log store.
   */
  static hasCodingAgentJoinableSpans(spans: Span[]): boolean {
    return spans.some(
      (span) =>
        readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null ||
        spanToolUseId(span) !== null ||
        isInteractionSpan(span),
    );
  }

  /**
   * True when this span could gain content from the join, the single-span twin of
   * `hasCodingAgentJoinableSpans`. The name prefix is included so future `claude_code.*` span
   * shapes at least attempt the join instead of silently skipping.
   */
  static isCodingAgentShapedSpan(span: Span): boolean {
    return (
      readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null ||
      spanToolUseId(span) !== null ||
      isInteractionSpan(span) ||
      (span.name ?? "").startsWith(CLAUDE_SPAN_NAME_PREFIX)
    );
  }

  /** Tool spans (`tool_use_id`-carrying) → exact-join refs. */
  static mapSpansToClaudeToolRefs(spans: Span[]): ClaudeToolSpanRef[] {
    const refs: ClaudeToolSpanRef[] = [];
    for (const span of spans) {
      const toolUseId = spanToolUseId(span);
      if (toolUseId !== null) {
        refs.push({ spanId: span.span_id, toolUseId });
      }
    }

    return refs;
  }

  /**
   * Interaction-span INPUT from its own `user_prompt` attribute — the one
   * claude content that rides the span itself, so it needs no log read and
   * must apply even when the trace has zero logs.
   */
  static enrichClaudeInteractionInputs(spans: Span[]): Span[] {
    let hasChanged = false;
    const next = spans.map((span) => {
      if (span.input != null) {
        return span;
      }

      const prompt = readStringParam(span.params, SPAN_USER_PROMPT_KEY);
      if (prompt === null) {
        return span;
      }

      hasChanged = true;

      return {
        ...span,
        input: {
          type: "text" as const,
          value: capPayloadString(prompt, undefined, "user_prompt"),
        },
      };
    });

    // Identity-preserving on no-op so callers' referential contracts (and
    // memoized readers) see an untouched trace as the SAME array.
    return hasChanged ? next : spans;
  }

  /**
   * Map stored log rows to {@link ClaudeContentLog}. The event payload rides the
   * `body` attribute (not the OTLP Body column) for the `api_*_body` events;
   * `user_prompt` carries its text on `prompt` instead.
   */
  static mapLogRowsToClaudeContentLogs(
    rows: TraceLogRecordReadRow[],
    codingAgents?: CodingAgentService,
  ): ClaudeContentLog[] {
    return rows.map((row) => {
      const attrs = row.attributes;
      const eventName = attrs[EVENT_NAME_ATTR] ?? "";
      const toolCallCount = Number(attrs[DERIVED_ATTRS.OUTPUT_TOOL_CALL_COUNT]);

      return {
        eventName,
        requestId: nonEmptyOrNull(attrs[REQUEST_ID_ATTR]),
        querySource: nonEmptyOrNull(attrs[QUERY_SOURCE_ATTR]),
        timeUnixMs: row.timeUnixMs,
        body: readContentBody(eventName, attrs, codingAgents),
        // Parsed out of the raw body once, at ingest, so the read path can skip
        // re-parsing it. Absent on records ingested before that existed, which is
        // why every consumer keeps its parse as a fallback.
        derivedOutputText: nonEmptyOrNull(attrs[DERIVED_ATTRS.OUTPUT_TEXT]),
        derivedToolCallCount: Number.isFinite(toolCallCount) ? toolCallCount : null,
      };
    });
  }

  /**
   * Attaches joined input and output onto the trace's spans: model calls by request_id, tool calls
   * by tool_use_id, and the interaction root from its own attribute plus a windowed reply. A new
   * array comes back, cloned only where enriched, and attribute-only input applies with no logs.
   */
  static enrichSpansWithClaudeLogContent({
    spans,
    logRows,
    traceCanonicalisation,
    codingAgents,
  }: {
    spans: Span[];
    logRows: TraceLogRecordReadRow[];
    traceCanonicalisation: TraceCanonicalisationService;
    codingAgents?: CodingAgentService;
  }): Span[] {
    if (spans.length === 0) {
      return spans;
    }

    const withInteractionInputs =
      ClaudeCodeLogEnrichmentService.enrichClaudeInteractionInputs(spans);
    if (logRows.length === 0) {
      return withInteractionInputs;
    }

    const logs = ClaudeCodeLogEnrichmentService.mapLogRowsToClaudeContentLogs(
      logRows,
      codingAgents,
    );
    const refs = ClaudeCodeLogEnrichmentService.mapSpansToClaudeRefs(withInteractionInputs);
    const enrichmentBySpanId = ClaudeCodeSpanEnrichmentService.computeClaudeSpanEnrichment({
      spans: refs,
      logs,
      traceCanonicalisation,
    });
    const toolEnrichmentBySpanId = ClaudeCodeSpanEnrichmentService.computeClaudeToolSpanEnrichment({
      spans: ClaudeCodeLogEnrichmentService.mapSpansToClaudeToolRefs(withInteractionInputs),
      toolLogs: ClaudeCodeLogEnrichmentService.mapLogRowsToClaudeToolLogs(logRows),
      contentLogs: logs,
      traceCanonicalisation,
    });

    return withInteractionInputs.map((span) => {
      const enrichment = enrichmentBySpanId.get(span.span_id);
      const toolEnrichment = toolEnrichmentBySpanId.get(span.span_id);
      const interactionOutput =
        span.output == null && isInteractionSpan(span)
          ? ClaudeCodeSpanEnrichmentService.tryComputeClaudeInteractionOutput({
              logs,
              windowStartMs: span.timestamps.started_at,
              windowEndMs: span.timestamps.finished_at,
              traceCanonicalisation,
            })
          : null;
      if (!enrichment && !toolEnrichment && interactionOutput === null) {
        return span;
      }

      const next: Span = { ...span };
      const input = enrichment?.input ?? toolEnrichment?.input ?? null;
      const output = enrichment?.output ?? toolEnrichment?.output ?? interactionOutput;
      if (input !== null && next.input == null) {
        next.input = input;
      }

      if (output !== null && next.output == null) {
        next.output = output;
      }

      return next;
    });
  }

  /**
   * Map stored log rows to {@link ClaudeToolLog} (tool_decision / tool_result
   * events only). Success arrives as the string "true"/"false"; numbers as
   * stringified numerics — both parsed here so the pure join sees clean types.
   */
  static mapLogRowsToClaudeToolLogs(rows: TraceLogRecordReadRow[]): ClaudeToolLog[] {
    const out: ClaudeToolLog[] = [];
    for (const row of rows) {
      const attrs = row.attributes;
      const eventName = attrs[EVENT_NAME_ATTR] ?? "";
      if (eventName !== TOOL_DECISION_EVENT && eventName !== TOOL_RESULT_EVENT) {
        continue;
      }

      out.push({
        eventName,
        toolUseId: nonEmptyOrNull(attrs[TOOL_USE_ID_ATTR]),
        toolName: nonEmptyOrNull(attrs[TOOL_NAME_ATTR]),
        toolParameters: nonEmptyOrNull(attrs[TOOL_PARAMETERS_ATTR]),
        toolInput: nonEmptyOrNull(attrs[TOOL_INPUT_ATTR]),
        decision: nonEmptyOrNull(attrs[DECISION_ATTR]),
        decisionSource:
          nonEmptyOrNull(attrs[RESULT_DECISION_SOURCE_ATTR]) ??
          nonEmptyOrNull(attrs[DECISION_SOURCE_ATTR]),
        success: parseBoolAttr(attrs[SUCCESS_ATTR]),
        durationMs: parseNumberAttr(attrs[DURATION_MS_ATTR]),
        resultSizeBytes: parseNumberAttr(attrs[RESULT_SIZE_ATTR]),
        timeUnixMs: row.timeUnixMs,
      });
    }

    return out;
  }

  /**
   * The IO wrapper both read paths share: it gates on the trace having Claude model-call spans,
   * does one lazy partition-pruned log read, and joins content onto the spans. Best-effort by
   * design, since tokens, timings and tool calls are still worth showing without content.
   */
  static async enrichCodingAgentSpansFromLogs({
    logRecords,
    tenantId,
    traceId,
    spans,
    occurredAtMs,
    logger,
    traceCanonicalisation,
    codingAgents,
  }: {
    logRecords: TraceLogRecordReader;
    tenantId: string;
    traceId: string;
    spans: Span[];
    /** Partition-pruning hint on the log store's `TimeUnixMs` partition key. */
    occurredAtMs?: number;
    logger?: Logger;
    traceCanonicalisation: TraceCanonicalisationService;
    codingAgents?: CodingAgentService;
  }): Promise<Span[]> {
    if (!ClaudeCodeLogEnrichmentService.hasCodingAgentJoinableSpans(spans)) {
      return spans;
    }

    try {
      const logRows = await logRecords.getLogsByTraceId(tenantId, traceId, occurredAtMs);

      return ClaudeCodeLogEnrichmentService.enrichSpansWithClaudeLogContent({
        spans,
        logRows,
        traceCanonicalisation,
        codingAgents,
      });
    } catch (error) {
      logger?.warn(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Claude Code log enrichment skipped: failed to read trace logs",
      );

      // Best-effort: the attribute-only interaction input needs no logs.
      return ClaudeCodeLogEnrichmentService.enrichClaudeInteractionInputs(spans);
    }
  }

  /**
   * Light summary rows to {@link ClaudeSpanRef}s for the single-span join: positional input pairing
   * needs the whole trace's model-call order, which the summary read supplies without full-span
   * cost. Rows arrive sorted from the repository, and are sorted again so the invariant holds.
   */
  static mapSummaryRowsToClaudeRefs(rows: SpanSummaryRow[]): ClaudeSpanRef[] {
    return rows
      .filter((row) => row.requestId !== null)
      .slice()
      .sort((a, b) => a.startTimeMs - b.startTimeMs)
      .map((row) => ({
        spanId: row.spanId,
        requestId: row.requestId,
        querySource: row.querySource,
      }));
  }

  /**
   * The single-span join: enriches one fetched span using the trace's logs plus, for model-call
   * spans, the light summary refs that give positional pairing its sibling order. Pure — the
   * caller owns the reads — and it never overwrites a non-null field.
   */
  static enrichSingleSpanWithClaudeLogContent({
    span,
    modelCallRefs,
    logRows,
    traceCanonicalisation,
    codingAgents,
  }: {
    span: Span;
    /** All model-call refs for the trace, [] when the span has no request_id. */
    modelCallRefs: ClaudeSpanRef[];
    logRows: TraceLogRecordReadRow[];
    traceCanonicalisation: TraceCanonicalisationService;
    codingAgents?: CodingAgentService;
  }): Span {
    const isModelCall = readStringParam(span.params, SPAN_REQUEST_ID_KEY) !== null;

    const [enriched] = ClaudeCodeLogEnrichmentService.enrichSpansWithClaudeLogContent({
      spans: [span],
      logRows,
      traceCanonicalisation,
      codingAgents,
    });
    let next = enriched!;

    // The bulk pass's tool join (exact, by tool_use_id) and interaction joins
    // are single-span safe. Its model-call INPUT is not: positional pairing
    // needs the whole trace's call order, and a one-span array degenerates
    // to "this is the group's first call" — discarded for model calls, the
    // full-refs join below is the only input source. Output is exact either way.
    if (isModelCall) {
      if (next !== span && next.input !== span.input) {
        next = { ...next, input: span.input };
      }

      if (modelCallRefs.length > 0 && logRows.length > 0) {
        const enrichment = ClaudeCodeSpanEnrichmentService.computeClaudeSpanEnrichment({
          spans: modelCallRefs,
          logs: ClaudeCodeLogEnrichmentService.mapLogRowsToClaudeContentLogs(logRows, codingAgents),
          traceCanonicalisation,
        }).get(span.span_id);
        if (enrichment) {
          const clone: Span = { ...next };
          if (enrichment.input !== null && span.input == null) {
            clone.input = enrichment.input;
          }

          if (enrichment.output !== null && clone.output == null) {
            clone.output = enrichment.output;
          }

          next = clone;
        }
      }
    }

    return next;
  }
}

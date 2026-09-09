/**
 * Claude Code span content enrichment, the pure core. Real `llm_request` spans carry tokens but no
 * content, which lives in separate OTLP log records, so this joins the two: output exactly by
 * request_id, input positionally, the Nth request body with the Nth span in one query source.
 */
import type { SpanInputOutput } from "@langwatch/trace-contract";
import { capPayloadString } from "../rules/trace-payload-cap.rules.ts";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  ASSISTANT_RESPONSE_EVENT,
  buildInputIndex,
  buildOutputIndex,
  OUTPUT_BODY_EVENT,
  type ClaudeContentLog,
  type ClaudeSpanEnrichment,
  type ClaudeSpanRef,
} from "../rules/claude-code-message-index.rules.ts";
import {
  buildToolInput,
  buildToolOutput,
  buildToolResultContentIndex,
  type ClaudeToolLog,
  type ClaudeToolSpanEnrichment,
  type ClaudeToolSpanRef,
  TOOL_DECISION_EVENT,
  TOOL_RESULT_EVENT,
} from "../rules/claude-code-tool-enrichment.rules.ts";

export class ClaudeCodeSpanEnrichmentService {
  static create(): ClaudeCodeSpanEnrichmentService {
    return new ClaudeCodeSpanEnrichmentService();
  }

  /**
   * Computes the input and output to attach to each model-call span from the trace's content logs.
   * The map is keyed by spanId and a span appears only when it gained something, so an unrelated
   * span, or a trace with no such logs, is left untouched.
   */
  static computeClaudeSpanEnrichment({
    spans,
    logs,
    traceCanonicalisation,
  }: {
    spans: ClaudeSpanRef[];
    logs: ClaudeContentLog[];
    traceCanonicalisation: TraceCanonicalisationService;
  }): Map<string, ClaudeSpanEnrichment> {
    const result = new Map<string, ClaudeSpanEnrichment>();
    if (spans.length === 0 || logs.length === 0) {
      return result;
    }

    const outputByRequestId = buildOutputIndex(logs, traceCanonicalisation);
    const inputBySpanId = buildInputIndex({ spans, logs, traceCanonicalisation });

    for (const span of spans) {
      const output =
        span.requestId !== null ? (outputByRequestId.get(span.requestId) ?? null) : null;
      const input = inputBySpanId.get(span.spanId) ?? null;
      if (input !== null || output !== null) {
        result.set(span.spanId, { input, output });
      }
    }

    return result;
  }

  /** First log per (event, tool_use_id) wins, mirroring buildOutputIndex. */
  static #indexToolLogsByUseId(
    toolLogs: ClaudeToolLog[],
  ): Readonly<{
    resultByUseId: Map<string, ClaudeToolLog>;
    decisionByUseId: Map<string, ClaudeToolLog>;
  }> {
    const resultByUseId = new Map<string, ClaudeToolLog>();
    const decisionByUseId = new Map<string, ClaudeToolLog>();
    for (const log of toolLogs) {
      if (log.toolUseId === null) {
        continue;
      }

      if (log.eventName === TOOL_RESULT_EVENT && !resultByUseId.has(log.toolUseId)) {
        resultByUseId.set(log.toolUseId, log);
      } else if (log.eventName === TOOL_DECISION_EVENT && !decisionByUseId.has(log.toolUseId)) {
        decisionByUseId.set(log.toolUseId, log);
      }
    }

    return { resultByUseId, decisionByUseId };
  }

  /**
   * Computes input and output for the trace's tool spans from tool event logs, joined exactly by
   * tool_use_id. Input is the tool_result's own arguments, then the derived parameters, then the
   * decision's; output is the real result content, or a structured summary when bodies are absent.
   */
  static computeClaudeToolSpanEnrichment({
    spans,
    toolLogs,
    contentLogs,
    traceCanonicalisation,
  }: {
    spans: ClaudeToolSpanRef[];
    toolLogs: ClaudeToolLog[];
    contentLogs: ClaudeContentLog[];
    traceCanonicalisation: TraceCanonicalisationService;
  }): Map<string, ClaudeToolSpanEnrichment> {
    const result = new Map<string, ClaudeToolSpanEnrichment>();
    if (spans.length === 0 || toolLogs.length === 0) {
      return result;
    }

    const { resultByUseId, decisionByUseId } =
      ClaudeCodeSpanEnrichmentService.#indexToolLogsByUseId(toolLogs);
    if (resultByUseId.size === 0 && decisionByUseId.size === 0) {
      return result;
    }

    const resultContentByUseId = buildToolResultContentIndex(contentLogs, traceCanonicalisation);

    for (const span of spans) {
      const toolResult = resultByUseId.get(span.toolUseId) ?? null;
      const decision = decisionByUseId.get(span.toolUseId) ?? null;
      if (toolResult === null && decision === null) {
        continue;
      }

      const input = buildToolInput({ toolResult, decision });
      const output = buildToolOutput({
        toolResult,
        decision,
        resultContent: resultContentByUseId.get(span.toolUseId) ?? null,
      });
      if (input !== null || output !== null) {
        result.set(span.spanId, { input, output });
      }
    }

    return result;
  }

  /** Whether this log falls inside the turn's window, with slack for a late exporter flush. */
  static #isInWindow(
    log: ClaudeContentLog,
    window: Readonly<{ startMs: number; endMs: number; slackMs: number }>,
  ): boolean {
    if (log.timeUnixMs < window.startMs) {
      return false;
    }

    return log.timeUnixMs <= window.endMs + window.slackMs;
  }

  /**
   * The reply text one log carries and how strongly it ranks: a parsed response body (1) beats
   * raw assistant text (0). Any other event carries no reply.
   */
  static #replyCandidate(
    log: ClaudeContentLog,
    traceCanonicalisation: TraceCanonicalisationService,
  ): Readonly<{ rank: number; text: string }> | null {
    if (log.eventName === OUTPUT_BODY_EVENT) {
      const derived =
        log.derivedOutputText != null && (log.derivedToolCallCount ?? 0) === 0
          ? log.derivedOutputText
          : null;
      const text =
        derived ??
        traceCanonicalisation.deriveClaudeResponseContent({ body: log.body }).assistantOutput;

      return text === null ? null : { rank: 1, text };
    }

    if (log.eventName !== ASSISTANT_RESPONSE_EVENT) {
      return null;
    }

    if (log.body === null || log.body.length === 0) {
      return null;
    }

    return { rank: 0, text: capPayloadString(log.body, undefined, "assistant_output") };
  }

  /**
   * The interaction span's output: the last conversational assistant reply inside the turn's
   * window, with slack for an exporter flushing just after close. A parsed response body beats raw
   * assistant text at the same timestamp, and both are gated so a utility reply never headlines.
   */
  static tryComputeClaudeInteractionOutput({
    logs,
    windowStartMs,
    windowEndMs,
    slackMs = 2_000,
    traceCanonicalisation,
  }: {
    logs: ClaudeContentLog[];
    windowStartMs: number;
    windowEndMs: number;
    slackMs?: number;
    traceCanonicalisation: TraceCanonicalisationService;
  }): SpanInputOutput | null {
    const window = { startMs: windowStartMs, endMs: windowEndMs, slackMs };
    let best: { timeUnixMs: number; rank: number; text: string } | null = null;

    for (const log of logs) {
      const conversational = traceCanonicalisation.classifyClaudeCall({
        querySource: log.querySource,
      }).conversational;
      if (!conversational) {
        continue;
      }

      if (!ClaudeCodeSpanEnrichmentService.#isInWindow(log, window)) {
        continue;
      }

      const candidate = ClaudeCodeSpanEnrichmentService.#replyCandidate(log, traceCanonicalisation);
      if (candidate === null) {
        continue;
      }

      const isBetterCandidate =
        best === null ||
        log.timeUnixMs > best.timeUnixMs ||
        (log.timeUnixMs === best.timeUnixMs && candidate.rank > best.rank);
      if (isBetterCandidate) {
        best = { timeUnixMs: log.timeUnixMs, rank: candidate.rank, text: candidate.text };
      }
    }

    return best !== null ? { type: "text", value: best.text } : null;
  }
}

/**
 * LangWatchQL app functions — the trace-keyed and span-keyed values.
 *
 * `llm_readable_trace`, the three `llm_messages*` functions, `llm_messages_span`
 * and `trace_json`. Every one of them is a thin call into machinery that
 * already exists and already has a reader: the span digest the online
 * evaluators and the scenario judge read, the message split the trace drawer's
 * two panels show, and the export serialiser. Nothing here renders anything of
 * its own, which is the point — a query and the product must not disagree about
 * what a trace says.
 *
 * @see ~/server/tracer/boundedSpansDigest.ts — the budgeted digest
 * @see ~/server/traces/llmSpanMessages.ts — the message extraction
 * @see ~/server/export/serializers/json-serializer.ts — the export shape
 */

import { serializeTraceToFullJson } from "~/server/export/serializers/json-serializer";
import { formatSpansDigestBounded } from "~/server/tracer/boundedSpansDigest";
import type { Trace } from "~/server/tracer/types";
import {
  llmMessagesForSpan,
  llmMessagesForTrace,
} from "~/server/traces/llmSpanMessages";

/** Which side of a captured call a messages function answers with. */
export type LlmMessagesSide = "both" | "input" | "output";

/**
 * The trace as the LLM-readable digest, under a token budget.
 *
 * Asynchronous because the formatter lives in the vendored scenario package and
 * is loaded on demand there; nothing about the computation itself is.
 */
export async function renderReadableTrace({
  trace,
  maxTokens,
}: {
  trace: Trace;
  maxTokens: number;
}): Promise<string> {
  const digest = await formatSpansDigestBounded({
    spans: trace.spans ?? [],
    maxTokens,
  });
  // As with the transcript: the budget is the caller's own argument, and the
  // digest says inside itself where it stopped.
  return digest.text;
}

/**
 * The trace's chat messages, as JSON.
 *
 * `"both"` answers `{input, output}` so one call carries the whole exchange;
 * the one-sided forms answer a bare array, because a caller asking for the
 * request side has no use for an object with one key. `null` when the trace
 * carries no readable conversation at all, which hydrates to a null cell
 * rather than to an empty array — "there was nothing here" and "the
 * conversation was empty" are different answers.
 */
export function renderTraceMessages({
  trace,
  side,
}: {
  trace: Trace;
  side: LlmMessagesSide;
}): string | null {
  const messages = llmMessagesForTrace({ trace, spans: trace.spans ?? [] });
  if (!messages) return null;
  if (side === "input") return JSON.stringify(messages.input);
  if (side === "output") return JSON.stringify(messages.output);
  return JSON.stringify(messages);
}

/**
 * One span's messages, and whether the trace holds that span at all.
 *
 * Two facts rather than one nullable string, because they are different
 * answers to the caller: a span id the trace does not carry named nothing and
 * is reported as an unresolved key, while a span that carries no readable
 * messages was found and genuinely holds none.
 */
export interface RenderedSpanMessages {
  readonly isSpanPresent: boolean;
  readonly json: string | null;
}

/**
 * One named span's chat messages, as JSON `{input, output}`.
 *
 * `null` both when the trace holds no such span and when the span holds no
 * readable conversation. The two are the same answer to the caller — this cell
 * has no messages — and distinguishing them would mean publishing which span
 * ids exist, which the `analytics.spans` dataset already answers properly.
 */
export function renderSpanMessages({
  trace,
  spanId,
}: {
  trace: Trace;
  spanId: string;
}): RenderedSpanMessages {
  const span = (trace.spans ?? []).find(
    (candidate) => candidate.span_id === spanId,
  );
  if (!span) return { isSpanPresent: false, json: null };
  const messages = llmMessagesForSpan({ span });
  const isEmpty = messages.input.length === 0 && messages.output.length === 0;
  return {
    isSpanPresent: true,
    json: isEmpty ? null : JSON.stringify(messages),
  };
}

/** The whole trace as one JSON object, spans included. */
export function renderTraceJson({ trace }: { trace: Trace }): string {
  return serializeTraceToFullJson({ trace });
}

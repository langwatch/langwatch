import { LLM_PARAMETER_MAP } from "~/prompts/prompt-playground/llmParameterMap";
import type { StoredTraceSpan } from "~/server/app-layer/traces/repositories/span-storage.repository";
import type { Span } from "~/server/tracer/types";
import { findPromptReferenceInAncestors } from "./findPromptReferenceInAncestors";
import { parseLLMSpanMessages } from "./parseLLMSpanMessages";
import { parsePromptReference } from "./parsePromptReference";
import type { PromptStudioSpanResult } from "./types";

/**
 * One span of a trace as the prompt playground reads it: the stored row's
 * columns, with its attributes exactly as stored. Both reads build these
 * rows, the legacy one straight from `stored_spans` and the one fenced by the
 * proof from the span store's stored read, so the playground sees the same
 * values whichever read loaded the trace.
 */
export interface PromptStudioSpanRow {
  SpanId: string;
  TraceId: string;
  ParentSpanId: string | null;
  SpanName: string;
  SpanAttributes: Record<string, unknown>;
  StartTime: number;
  EndTime: number;
  DurationMs: number;
  StatusCode: number | null;
  StatusMessage: string | null;
}

/**
 * A span the span store returned with its stored attributes, as the
 * playground reads it. The attributes pass through untouched: parsing them
 * and writing them back would rewrite number-like strings ("0042" to "42",
 * "1.50" to "1.5") that the legacy read hands over as stored.
 */
export function promptStudioRowFromStoredSpan(
  span: StoredTraceSpan,
): PromptStudioSpanRow {
  return {
    SpanId: span.spanId,
    TraceId: span.traceId,
    ParentSpanId: span.parentSpanId,
    SpanName: span.name,
    SpanAttributes: span.spanAttributes,
    StartTime: span.startTimeUnixMs,
    EndTime: span.endTimeUnixMs,
    DurationMs: span.durationMs,
    StatusCode: span.statusCode,
    StatusMessage: span.statusMessage,
  };
}

/**
 * The playground's view of one span in a trace, given every span of that
 * trace. Returns null when the span is not in the trace, or when it is not
 * an llm span and the trace holds no llm span to load in its place.
 */
export function promptStudioSpanFromTrace({
  rows,
  spanId,
}: {
  rows: PromptStudioSpanRow[];
  spanId: string;
}): PromptStudioSpanResult | null {
  const row = promptStudioLlmRowFromTrace({ rows, spanId });
  if (!row) {
    return null;
  }
  return promptStudioSpanFromLlmRow({ row, rows });
}

/**
 * The llm row the playground loads for a requested span: the span itself when
 * it is an llm span, else the nearest llm span in the trace. Returns null when
 * the span is not in the trace, or when no llm row can be loaded in its place.
 */
export function promptStudioLlmRowFromTrace({
  rows,
  spanId,
}: {
  rows: PromptStudioSpanRow[];
  spanId: string;
}): PromptStudioSpanRow | null {
  const requestedRow = rows.find((r) => r.SpanId === spanId);
  if (!requestedRow) {
    return null;
  }

  // If the caller pointed us at a non-llm span (e.g. the user
  // clicked "Open in Playground" from the Prompt.compile or
  // PromptApiService.get span, or from the Prompts tab usage
  // card), resolve to the nearest llm in the trace that the
  // operator most likely meant: a descendant first, then a
  // sibling that started at or after the requested span. The
  // playground form needs an llm span's messages + llm config,
  // anything else lands as "No prompts open".
  return isLlmRow(requestedRow)
    ? requestedRow
    : findNearestLlm(rows, requestedRow);
}

/**
 * The playground's view of one llm row, given every span of its trace. Kept
 * apart from the row selection so a read can restore the llm row's offloaded
 * content before it is extracted, while the ancestor walk still reads the
 * stored rows.
 */
export function promptStudioSpanFromLlmRow({
  row,
  rows,
}: {
  row: PromptStudioSpanRow;
  rows: PromptStudioSpanRow[];
}): PromptStudioSpanResult {
  const result = extractPromptStudioData(row);

  // If the LLM span itself doesn't have a prompt reference,
  // search ancestors and their siblings to find it (SDK sets it on
  // sibling spans like Prompt.compile or PromptApiService.get)
  if (!result.promptHandle) {
    applyAncestorPromptReference({ result, row, rows });
  }

  return result;
}

/** The prompt reference keys the ancestor walk reads off each span. */
const PROMPT_REFERENCE_ATTRIBUTES = [
  "langwatch.prompt.id",
  "langwatch.prompt.variables",
  "langwatch.prompt.handle",
  "langwatch.prompt.version.number",
] as const;

function isLlmRow(row: PromptStudioSpanRow): boolean {
  return (
    (row.SpanAttributes["langwatch.span.type"] as string | undefined) === "llm"
  );
}

/**
 * Fills the result's prompt reference from the closest preceding span that
 * carries one, when the llm span itself carries none.
 */
function applyAncestorPromptReference({
  result,
  row,
  rows,
}: {
  result: PromptStudioSpanResult;
  row: PromptStudioSpanRow;
  rows: PromptStudioSpanRow[];
}): void {
  const ancestorRef = findPromptReferenceInAncestors({
    targetSpanId: row.SpanId,
    spans: rows.map((r) => ({
      spanId: r.SpanId,
      parentSpanId: r.ParentSpanId ?? null,
      startTime: r.StartTime,
      attributes: promptReferenceAttributesOf(r),
    })),
  });
  if (ancestorRef?.promptHandle) {
    result.promptHandle = ancestorRef.promptHandle;
    result.promptVersionNumber = ancestorRef.promptVersionNumber;
    result.promptTag = ancestorRef.promptTag;
    result.promptVariables = ancestorRef.promptVariables;
  }
}

function promptReferenceAttributesOf(
  row: PromptStudioSpanRow,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const key of PROMPT_REFERENCE_ATTRIBUTES) {
    const value = row.SpanAttributes[key];
    if (value) attributes[key] = value;
  }
  return attributes;
}

/** The playground data one llm span's stored attributes carry. */
function extractPromptStudioData(
  row: PromptStudioSpanRow,
): PromptStudioSpanResult {
  const attrs = row.SpanAttributes;
  // Pure extraction of input + output messages from the span's
  // attributes. Lives in parseLLMSpanMessages.ts so the wire-shape
  // contract, including the single-message-object form nlpgo emits
  // for langwatch.output, is unit-testable without standing up the
  // full service. See that file's docstring for the shape catalog.
  const messages: PromptStudioSpanResult["messages"] =
    parseLLMSpanMessages(attrs);
  const promptRef = parsePromptReference(attrs);

  return {
    spanId: row.SpanId,
    traceId: row.TraceId,
    spanName: row.SpanName ?? null,
    messages,
    llmConfig: llmConfigOf({ attrs, messages }),
    vendor: (attrs["gen_ai.system"] as string) ?? null,
    error: errorOf(row),
    timestamps: {
      started_at: row.StartTime,
      finished_at: row.EndTime,
    },
    metrics: metricsOf(attrs),
    promptHandle: promptRef.promptHandle,
    promptVersionNumber: promptRef.promptVersionNumber,
    promptTag: promptRef.promptTag,
    promptVariables: promptRef.promptVariables,
  };
}

/** The llm config, built dynamically from the parameter map. */
function llmConfigOf({
  attrs,
  messages,
}: {
  attrs: Record<string, unknown>;
  messages: PromptStudioSpanResult["messages"];
}): PromptStudioSpanResult["llmConfig"] {
  const model =
    (attrs["gen_ai.response.model"] as string) ??
    (attrs["gen_ai.request.model"] as string) ??
    (attrs["llm.model"] as string) ??
    null;
  const llmConfig: PromptStudioSpanResult["llmConfig"] = {
    model,
    systemPrompt: messages.find((m) => m.role === "system")?.content,
    temperature: null,
    maxTokens: null,
    topP: null,
    frequencyPenalty: null,
    presencePenalty: null,
    seed: null,
    topK: null,
    minP: null,
    repetitionPenalty: null,
    reasoning: null,
    verbosity: null,
    litellmParams: {},
  };

  for (const param of LLM_PARAMETER_MAP) {
    if (param.otelAttr === null) continue;
    const raw = attrs[param.otelAttr];
    if (raw != null) {
      (llmConfig as Record<string, unknown>)[param.formField] = raw;
    }
  }
  return llmConfig;
}

function errorOf(row: PromptStudioSpanRow): Span["error"] | null {
  if (row.StatusCode !== 2) return null;
  return {
    has_error: true,
    message: row.StatusMessage ?? "Unknown error",
    stacktrace: [],
  };
}

function metricsOf(
  attrs: Record<string, unknown>,
): PromptStudioSpanResult["metrics"] {
  const promptTokens = attrs["gen_ai.usage.prompt_tokens"] as
    | number
    | undefined;
  const completionTokens = attrs["gen_ai.usage.completion_tokens"] as
    | number
    | undefined;
  if (promptTokens === undefined && completionTokens === undefined) {
    return null;
  }
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens };
}

/**
 * Given a non-llm span the operator clicked "Open in Playground" from
 * (typically `Prompt.compile` or `PromptApiService.get`), find the
 * nearest llm in the same trace to load instead. Preference order:
 *   1. Closest descendant llm under the requested span, usually a child
 *      llm call that consumed the just-compiled prompt.
 *   2. Sibling llm under the same parent that started after the
 *      requested span: the next llm call in the chain.
 *   3. First llm in the trace by start time as a last resort.
 * Returns null when the trace genuinely has no llm spans.
 */
function findNearestLlm(
  rows: PromptStudioSpanRow[],
  requested: PromptStudioSpanRow,
): PromptStudioSpanRow | null {
  const llmRows = rows.filter(isLlmRow);
  if (llmRows.length === 0) return null;

  const childrenByParent = childrenByParentOf(rows);
  return (
    descendantLlm({ requested, childrenByParent }) ??
    nextSiblingLlm({ rows, requested, childrenByParent }) ??
    // 3. Earliest llm in the trace.
    llmRows.sort((a, b) => a.StartTime - b.StartTime)[0] ??
    null
  );
}

function childrenByParentOf(
  rows: PromptStudioSpanRow[],
): Map<string, PromptStudioSpanRow[]> {
  const childrenByParent = new Map<string, PromptStudioSpanRow[]>();
  for (const r of rows) {
    if (!r.ParentSpanId) continue;
    const list = childrenByParent.get(r.ParentSpanId);
    if (list) list.push(r);
    else childrenByParent.set(r.ParentSpanId, [r]);
  }
  return childrenByParent;
}

/** 1. Descendant llm closest to the requested span (smallest depth diff). */
function descendantLlm({
  requested,
  childrenByParent,
}: {
  requested: PromptStudioSpanRow;
  childrenByParent: Map<string, PromptStudioSpanRow[]>;
}): PromptStudioSpanRow | null {
  const visited = new Set<string>();
  const queue: PromptStudioSpanRow[] = [requested];
  let current = queue.shift();
  while (current) {
    if (!visited.has(current.SpanId)) {
      visited.add(current.SpanId);
      const children = childrenByParent.get(current.SpanId) ?? [];
      const llmChild = children.find(isLlmRow);
      if (llmChild) return llmChild;
      queue.push(...children);
    }
    current = queue.shift();
  }
  return null;
}

/**
 * 2. Sibling llm under the same parent (or root-level peer if the
 * requested span has no parent) that started at/after the requested
 * span. Earliest qualifying sibling wins, so we land on the *next*
 * call rather than one further down the chain. Siblings that
 * started *before* the requested span do NOT count, since those belong
 * to an earlier turn and would open an unrelated playground
 * context, so the search falls through to step 3 instead.
 */
function nextSiblingLlm({
  rows,
  requested,
  childrenByParent,
}: {
  rows: PromptStudioSpanRow[];
  requested: PromptStudioSpanRow;
  childrenByParent: Map<string, PromptStudioSpanRow[]>;
}): PromptStudioSpanRow | null {
  const siblingPool =
    requested.ParentSpanId == null
      ? rows.filter((r) => r.ParentSpanId == null)
      : (childrenByParent.get(requested.ParentSpanId) ?? []);
  return (
    siblingPool
      .filter((s) => s.SpanId !== requested.SpanId && isLlmRow(s))
      .sort((a, b) => a.StartTime - b.StartTime)
      .find((s) => s.StartTime >= requested.StartTime) ?? null
  );
}

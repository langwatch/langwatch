import {
  findPromptReferenceInAncestors,
  LLM_PARAMETER_MAP,
  parsePromptTraceReference,
} from "@langwatch/prompt-contract";
import type { PromptStudioSpanResult } from "@langwatch/trace-contract";

import type { StoredTraceSpan } from "../../../repositories/span-storage.repository.ts";
import {
  parseLLMSpanMessages,
  systemPromptFieldOfLlmSpan,
} from "../../conversation/rules/trace-llm-span-messages.rules.ts";

/**
 * One span of a trace as the prompt playground reads it: the stored row's
 * columns with its attributes exactly as stored, whichever read loaded it.
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
 * A stored span as the playground reads it. Attributes pass through untouched:
 * re-parsing would rewrite number-like strings ("0042" to "42").
 */
export function promptStudioRowFromStoredSpan(span: StoredTraceSpan): PromptStudioSpanRow {
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
 * The playground's view of one span, given every span of its trace. Undefined when
 * the span is not in the trace, or is not llm and the trace holds no llm span.
 */
export function derivePromptStudioSpan({
  rows,
  spanId,
}: {
  rows: PromptStudioSpanRow[];
  spanId: string;
}): PromptStudioSpanResult | undefined {
  const requestedRow = rows.find((r) => r.SpanId === spanId);
  if (!requestedRow) {
    return undefined;
  }

  // A non-llm span (e.g. Prompt.compile) resolves to the llm the operator most likely
  // meant: a descendant first, then a later sibling. The form needs an llm span.
  const row = isLlmRow(requestedRow) ? requestedRow : pickNearestLlm(rows, requestedRow);
  if (!row) {
    return undefined;
  }

  const result = extractPromptStudioData(row);

  // The SDK sets the prompt reference on sibling spans (Prompt.compile, PromptApiService.get)
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
  return (row.SpanAttributes["langwatch.span.type"] as string | undefined) === "llm";
}

/** Fills the prompt reference from the closest preceding span carrying one. */
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

function promptReferenceAttributesOf(row: PromptStudioSpanRow): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const key of PROMPT_REFERENCE_ATTRIBUTES) {
    const value = row.SpanAttributes[key];
    if (value) attributes[key] = value;
  }
  return attributes;
}

/** The playground data one llm span's stored attributes carry. */
function extractPromptStudioData(row: PromptStudioSpanRow): PromptStudioSpanResult {
  const attrs = row.SpanAttributes;
  const messages: PromptStudioSpanResult["messages"] = parseLLMSpanMessages(attrs);
  const promptRef = parsePromptTraceReference(attrs);

  return {
    spanId: row.SpanId,
    traceId: row.TraceId,
    spanName: row.SpanName ?? null,
    messages,
    llmConfig: llmConfigOf({ attrs, messages }),
    vendor: (attrs["gen_ai.system"] as string) ?? null,
    error:
      row.StatusCode === 2
        ? { has_error: true, message: row.StatusMessage ?? "Unknown error", stacktrace: [] }
        : null,
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
    ...systemPromptFieldOfLlmSpan({ attrs, messages }),
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

function metricsOf(attrs: Record<string, unknown>): PromptStudioSpanResult["metrics"] {
  const promptTokens = attrs["gen_ai.usage.prompt_tokens"] as number | undefined;
  const completionTokens = attrs["gen_ai.usage.completion_tokens"] as number | undefined;
  if (promptTokens === undefined && completionTokens === undefined) {
    return null;
  }
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens };
}

/**
 * The llm to load for a non-llm span: closest descendant, then the next sibling by
 * start time, then the trace's earliest llm. Undefined when the trace has none.
 */
function pickNearestLlm(
  rows: PromptStudioSpanRow[],
  requested: PromptStudioSpanRow,
): PromptStudioSpanRow | undefined {
  const llmRows = rows.filter(isLlmRow);
  if (llmRows.length === 0) return undefined;

  const childrenByParent = childrenByParentOf(rows);
  return (
    pickDescendantLlm({ requested, childrenByParent }) ??
    pickNextSiblingLlm({ rows, requested, childrenByParent }) ??
    llmRows.toSorted((a, b) => a.StartTime - b.StartTime)[0]
  );
}

function childrenByParentOf(rows: PromptStudioSpanRow[]): Map<string, PromptStudioSpanRow[]> {
  const childrenByParent = new Map<string, PromptStudioSpanRow[]>();
  for (const r of rows) {
    if (!r.ParentSpanId) continue;
    const list = childrenByParent.get(r.ParentSpanId);
    if (list) list.push(r);
    else childrenByParent.set(r.ParentSpanId, [r]);
  }
  return childrenByParent;
}

/** Descendant llm closest to the requested span (breadth first). */
function pickDescendantLlm({
  requested,
  childrenByParent,
}: {
  requested: PromptStudioSpanRow;
  childrenByParent: Map<string, PromptStudioSpanRow[]>;
}): PromptStudioSpanRow | undefined {
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
  return undefined;
}

/**
 * Earliest llm sibling (same parent, or root peer) starting at/after the requested
 * span. Earlier siblings belong to a prior turn and fall through to the next step.
 */
function pickNextSiblingLlm({
  rows,
  requested,
  childrenByParent,
}: {
  rows: PromptStudioSpanRow[];
  requested: PromptStudioSpanRow;
  childrenByParent: Map<string, PromptStudioSpanRow[]>;
}): PromptStudioSpanRow | undefined {
  const siblingPool =
    requested.ParentSpanId == null
      ? rows.filter((r) => r.ParentSpanId == null)
      : (childrenByParent.get(requested.ParentSpanId) ?? []);
  return siblingPool
    .filter((s) => s.SpanId !== requested.SpanId && isLlmRow(s))
    .toSorted((a, b) => a.StartTime - b.StartTime)
    .find((s) => s.StartTime >= requested.StartTime);
}

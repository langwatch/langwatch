import {
  DEFAULT_TOKEN_THRESHOLD,
  estimateTokens,
  judgeSpanDigestFormatter,
} from "@langwatch/scenario";
import {
  cutToEstimatedTokensKeepingEnds,
  type Span,
  type SpanTypes,
} from "@langwatch/trace-contract";
import type { Attributes, HrTime, SpanContext, SpanStatus } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import { emptyResource } from "@opentelemetry/resources";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import { rankSpansForExpansion } from "./bounded-spans-digest.rules.ts";

function msToHrTime(ms: number): HrTime {
  const seconds = Math.trunc(ms / 1000);
  const nanoseconds = (ms % 1000) * 1_000_000;

  return [seconds, nanoseconds];
}

function hrTimeDuration(start: HrTime, end: HrTime): HrTime {
  let seconds = end[0]! - start[0]!;
  let nanoseconds = end[1]! - start[1]!;
  if (nanoseconds < 0) {
    seconds -= 1;
    nanoseconds += 1_000_000_000;
  }

  return [seconds, nanoseconds];
}

function spanTypeToKind(type: SpanTypes): SpanKind {
  switch (type) {
    case "server":
      return SpanKind.SERVER;
    case "client":
      return SpanKind.CLIENT;
    case "producer":
      return SpanKind.PRODUCER;
    case "consumer":
      return SpanKind.CONSUMER;
    default:
      return SpanKind.INTERNAL;
  }
}

/**
 * Recursively flattens a nested params object into dot-notation OTEL attributes: primitives set
 * directly, plain objects recursed, arrays JSON-stringified, null and undefined skipped, and the
 * `_keys` field skipped as an indexing artifact.
 */
function flattenParams({
  params,
  prefix,
  attrs,
}: {
  params: Record<string, unknown>;
  prefix: string;
  attrs: Attributes;
}): void {
  for (const [key, value] of Object.entries(params)) {
    if (key === "_keys") {
      continue;
    }

    if (value == null) {
      continue;
    }

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attrs[fullKey] = value;
    } else if (Array.isArray(value)) {
      attrs[fullKey] = JSON.stringify(value);
    } else if (typeof value === "object") {
      flattenParams({
        params: value as Record<string, unknown>,
        prefix: fullKey,
        attrs,
      });
    }
  }
}

function buildAttributes(span: Span): Attributes {
  const attrs: Attributes = {};

  attrs["langwatch.span.type"] = span.type;
  assignIo({ attrs, value: span.input, messagesKey: "gen_ai.input.messages", plainKey: "input" });
  assignIo({
    attrs,
    value: span.output,
    messagesKey: "gen_ai.output.messages",
    plainKey: "output",
  });

  if ("model" in span && span.model) {
    attrs["gen_ai.request.model"] = span.model;
  }

  if ("vendor" in span && span.vendor) {
    attrs["gen_ai.system"] = span.vendor;
  }

  assignParams({ attrs, span });
  assignMetrics({ attrs, metrics: span.metrics });
  if ("contexts" in span && span.contexts) {
    attrs["retrieval.documents"] = JSON.stringify(span.contexts);
  }
  dropAliasedCounts(attrs);

  return attrs;
}

/**
 * Keys that name the same count, most canonical first. A vendor that reports
 * both families would otherwise print every count twice.
 */
const ALIASED_KEYS: readonly (readonly string[])[] = [
  ["gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "input_tokens", "prompt_tokens"],
  [
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.completion_tokens",
    "output_tokens",
    "completion_tokens",
  ],
  [
    "gen_ai.usage.cache_read.input_tokens",
    "gen_ai.usage.cache_read_input_tokens",
    "cache_read_tokens",
    "cache_read_input_tokens",
  ],
  [
    "gen_ai.usage.cache_creation.input_tokens",
    "gen_ai.usage.cache_creation_input_tokens",
    "cache_creation_tokens",
    "cache_creation_input_tokens",
  ],
  ["gen_ai.request.model", "model"],
  ["gen_ai.response.id", "request_id"],
];

/** Each aliased count once, under the first key of its family the span carries. */
function dropAliasedCounts(attrs: Attributes): void {
  for (const family of ALIASED_KEYS) {
    const kept = family.find((key) => attrs[key] !== undefined);
    if (kept === undefined) continue;
    for (const key of family) {
      if (key !== kept && attrs[key] === attrs[kept]) delete attrs[key];
    }
  }
}

/** One side of the conversation, under the messages key for a chat, `input`/`output` otherwise. */
function assignIo({
  attrs,
  value,
  messagesKey,
  plainKey,
}: {
  attrs: Attributes;
  value: Span["input"];
  messagesKey: string;
  plainKey: string;
}): void {
  if (!value) {
    return;
  }

  if (value.type === "chat_messages") {
    attrs[messagesKey] = JSON.stringify(value.value);

    return;
  }

  if (value.type === "json") {
    attrs[plainKey] = JSON.stringify(value.value);

    return;
  }

  if (value.type === "text" || value.type === "raw") {
    attrs[plainKey] = value.value;
  }
}

/** The attributes a span's input and output are read from, in extractInput/extractOutput order. */
const IO_SOURCE_KEYS = {
  input: ["gen_ai.input.messages", "langwatch.input", "gen_ai.tool.call.arguments"],
  output: ["gen_ai.output.messages", "langwatch.output", "gen_ai.tool.call.result"],
} as const;

const isUnder = ({ key, source }: { key: string; source: string }) =>
  key === source || key.startsWith(`${source}.`);

/** The source attribute each printed side was read from: the first of its keys the span carries. */
function printedSources({ span, keys }: { span: Span; keys: string[] }): string[] {
  return (["input", "output"] as const).flatMap((side) => {
    if (!span[side]) return [];
    const source = IO_SOURCE_KEYS[side].find((candidate) =>
      keys.some((key) => isUnder({ key, source: candidate })),
    );
    return source ? [source] : [];
  });
}

/**
 * The named request parameters, plus everything else the span carried, flattened, less the
 * attributes already printed as the span's input and output.
 */
function assignParams({ attrs, span }: { attrs: Attributes; span: Span }): void {
  const { params } = span;
  if (!params) {
    return;
  }

  if (params.temperature != null) {
    attrs["gen_ai.request.temperature"] = params.temperature;
  }

  if (params.max_tokens != null) {
    attrs["gen_ai.request.max_tokens"] = params.max_tokens;
  }

  if (params.top_p != null) {
    attrs["gen_ai.request.top_p"] = params.top_p;
  }

  const flattened: Attributes = {};
  flattenParams({ params, prefix: "", attrs: flattened });
  const printed = printedSources({ span, keys: Object.keys(flattened) });
  for (const [key, value] of Object.entries(flattened)) {
    if (!printed.some((source) => isUnder({ key, source }))) attrs[key] = value;
  }
}

/** The token counts and cost, each only when the span reported it. */
function assignMetrics({ attrs, metrics }: { attrs: Attributes; metrics: Span["metrics"] }): void {
  if (!metrics) {
    return;
  }

  if (metrics.prompt_tokens != null) {
    attrs["gen_ai.usage.prompt_tokens"] = metrics.prompt_tokens;
  }

  if (metrics.completion_tokens != null) {
    attrs["gen_ai.usage.completion_tokens"] = metrics.completion_tokens;
  }

  if (metrics.cost != null) {
    attrs["gen_ai.usage.cost"] = metrics.cost;
  }
}

function buildStatus(span: Span): SpanStatus {
  if (span.error) {
    return { code: SpanStatusCode.ERROR, message: span.error.message };
  }

  return { code: SpanStatusCode.OK };
}

/**
 * A whole trace's spans rendered as the one readable digest a judge reads. The formatter is the
 * scenario judge's, because the digest a judge is shown and the digest an evaluator is shown
 * have to be the same text — a second renderer would grade one thing and display another.
 */
export function formatSpansDigest(spans: Span[]): Promise<string> {
  const { readableSpans, shared } = readableSpansForDigest(spans);

  return Promise.resolve(
    withSharedAttributes({ digest: judgeSpanDigestFormatter.format(readableSpans), shared }),
  );
}

/** Never hoisted: what a span is, and what it read and wrote. */
const PER_SPAN_KEYS = new Set([
  "langwatch.span.type",
  "input",
  "output",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
]);

/** Printed as its parent's, since an execution phase restates its tool call. */
const REPEATED_IO_KEYS = ["input", "output", "gen_ai.input.messages", "gen_ai.output.messages"];

/**
 * The trace's spans as the digest reads them: attributes every span carries
 * with one value are lifted out to print once, and a child that restates its
 * parent's input and output prints only what differs, naming what it repeats.
 * @see modules/trace/specs/trace-span-digest.feature
 */
function readableSpansForDigest(spans: Span[]): {
  readableSpans: ReadableSpan[];
  shared: [string, Attributes[string]][];
} {
  const readableSpans = spans.map((span) => langwatchSpanToReadableSpan(span));
  const shared = sharedAttributes(readableSpans);
  for (const span of readableSpans) {
    for (const [key] of shared) delete span.attributes[key];
  }
  const byId = new Map(readableSpans.map((span) => [span.spanContext().spanId, span]));
  const parentAttributes = new Map(
    readableSpans.map((span) => [span.spanContext().spanId, { ...span.attributes }]),
  );
  for (const span of readableSpans) {
    const parentId = span.parentSpanContext?.spanId;
    const parent = parentId && byId.has(parentId) ? parentAttributes.get(parentId) : undefined;
    if (parent) foldRepeatOfParent({ attrs: span.attributes, parent });
  }
  return { readableSpans, shared };
}

function foldRepeatOfParent({ attrs, parent }: { attrs: Attributes; parent: Attributes }): void {
  const hasIo = REPEATED_IO_KEYS.some((key) => attrs[key] !== undefined);
  const repeatsIo = REPEATED_IO_KEYS.every((key) => attrs[key] === parent[key]);
  if (!hasIo || !repeatsIo) return;
  const repeated = Object.keys(attrs).filter(
    (key) => key !== "langwatch.span.type" && attrs[key] === parent[key],
  );
  for (const key of repeated) delete attrs[key];
  attrs.same_as_parent = repeated.join(", ");
}

function sharedAttributes(spans: ReadableSpan[]): [string, Attributes[string]][] {
  const [first, ...rest] = spans;
  if (!first || rest.length === 0) return [];
  return Object.entries(first.attributes).filter(
    ([key, value]) =>
      !PER_SPAN_KEYS.has(key) && rest.every((span) => span.attributes[key] === value),
  );
}

/** The digest with the attributes every span shares printed once, under its first line. */
function withSharedAttributes({
  digest,
  shared,
}: {
  digest: string;
  shared: [string, Attributes[string]][];
}): string {
  if (shared.length === 0) return digest;
  const breakAt = digest.indexOf("\n");
  const header = [
    "On every span:",
    ...shared.map(([key, value]) => `    ${key}: ${String(value)}`),
  ].join("\n");
  if (breakAt < 0) return `${digest}\n${header}`;
  return `${digest.slice(0, breakAt)}\n${header}${digest.slice(breakAt)}`;
}

/**
 * The same digest under a token budget: the whole thing when it fits, else
 * the structure-only skeleton plus as many expanded spans as fit in the
 * order a reader wants them, else the skeleton cut to the budget.
 * @see specs/traces/trace-extraction-modules.feature
 */
export function formatSpansDigestBounded({
  spans,
  maxTokens,
}: {
  spans: Span[];
  /** Defaults to the scenario judge's own threshold. */
  maxTokens?: number;
}): BoundedSpansDigest {
  const budget = maxTokens ?? DEFAULT_TOKEN_THRESHOLD;
  const { readableSpans, shared } = readableSpansForDigest(spans);

  const full = withSharedAttributes({
    digest: judgeSpanDigestFormatter.format(readableSpans),
    shared,
  });
  const fullTokens = estimateTokens(full);
  if (fullTokens <= budget) {
    return { text: full, isTruncated: false, estimatedTokens: fullTokens };
  }

  const structure = withSharedAttributes({
    digest: judgeSpanDigestFormatter.formatStructureOnly(readableSpans),
    shared,
  });
  if (estimateTokens(structure) > budget) {
    // One span per line, so the cut lands on a line break: half a tree line
    // names a span that does not exist.
    const text = cutToEstimatedTokensKeepingEnds({
      text: structure,
      maxTokens: budget,
      atLineBreak: true,
    });
    return { text, isTruncated: true, estimatedTokens: estimateTokens(text) };
  }

  return expandedWithinBudget({ spans, readableSpans, structure, budget });
}

export function langwatchSpanToReadableSpan(span: Span): ReadableSpan {
  const startTime = msToHrTime(span.timestamps.started_at);
  const endTime = msToHrTime(span.timestamps.finished_at);
  const duration = hrTimeDuration(startTime, endTime);

  const spanCtx: SpanContext = {
    traceId: span.trace_id,
    spanId: span.span_id,
    traceFlags: TraceFlags.SAMPLED,
  };

  const parentSpanCtx: SpanContext | undefined = span.parent_id
    ? {
        traceId: span.trace_id,
        spanId: span.parent_id,
        traceFlags: TraceFlags.SAMPLED,
      }
    : undefined;

  const resource = emptyResource();

  return {
    name: span.name ?? "",
    kind: spanTypeToKind(span.type),
    spanContext: () => spanCtx,
    parentSpanContext: parentSpanCtx,
    startTime,
    endTime,
    status: buildStatus(span),
    attributes: buildAttributes(span),
    links: [],
    events: [],
    duration,
    ended: true,
    resource,
    instrumentationScope: { name: "langwatch" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/** A trace digest rendered for a model, with what it cost and what it lost. */
export interface BoundedSpansDigest {
  text: string;
  /** Whether anything was left out to fit the budget. */
  isTruncated: boolean;
  estimatedTokens: number;
}

/**
 * The skeleton with as many fully expanded spans as the budget takes. A span
 * that does not fit is skipped, since a cheaper one further down still earns
 * its place; the best-ranked one left out then gets what remains, ends kept.
 */
function expandedWithinBudget({
  spans,
  readableSpans,
  structure,
  budget,
}: {
  spans: Span[];
  readableSpans: ReadableSpan[];
  structure: string;
  budget: number;
}): BoundedSpansDigest {
  const budgetBytes = budget * 4;
  let usedBytes = byteLength(structure);
  const readableOf = new Map(spans.map((span, index) => [span, readableSpans[index]!]));
  const blocks = new Map<string, string>();
  let firstSkipped: Span | undefined;
  for (const span of rankSpansForExpansion(spans)) {
    const block = renderSpanBlock(readableOf.get(span)!);
    const cost = byteLength(`${BLOCK_SEPARATOR}${block}`);
    if (usedBytes + cost > budgetBytes) {
      firstSkipped ??= span;
      continue;
    }
    blocks.set(span.span_id, block);
    usedBytes += cost;
  }

  const remainingTokens =
    Math.floor((budgetBytes - usedBytes) / 4) - estimateTokens(BLOCK_SEPARATOR);
  if (firstSkipped && remainingTokens >= MIN_PARTIAL_SPAN_TOKENS) {
    blocks.set(
      firstSkipped.span_id,
      cutToEstimatedTokensKeepingEnds({
        text: renderSpanBlock(readableOf.get(firstSkipped)!),
        maxTokens: remainingTokens,
        atLineBreak: true,
      }),
    );
  }

  const ordered = spans.flatMap((span) => blocks.get(span.span_id) ?? []);
  const text = [structure, ...ordered].join(BLOCK_SEPARATOR);
  return { text, isTruncated: true, estimatedTokens: estimateTokens(text) };
}

const BLOCK_SEPARATOR = "\n\n";

/** Below this, a partly expanded span says too little to be worth its tokens. */
const MIN_PARTIAL_SPAN_TOKENS = 128;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * One span in full, as the digest writes it, with no size cap: the scenario
 * judge's own expand tool stops at its tool-result budget and then tells the
 * reader to call tools a classifier does not have.
 */
function renderSpanBlock(span: ReadableSpan): string {
  const digest = judgeSpanDigestFormatter.format([{ ...span, parentSpanContext: undefined }]);
  const body = digest.split("\n").slice(2).join("\n");
  const errorsAt = body.indexOf("\n=== ERRORS ===");
  return (errorsAt >= 0 ? body.slice(0, errorsAt) : body).trimEnd();
}

import type {
  ErrorCapture,
  LegacySpanInputOutput,
  Span,
  SpanInputOutput,
  Trace,
} from "@langwatch/trace-contract";

/**
 * Teaser truncation rule: keep the first max(TEASER_MIN_CHARS, min(TEASER_MAX_CHARS, ceil(len *
 * TEASER_FRACTION))) characters of each content field. The floor keeps tiny traces legible as
 * teasers; the cap stops large payloads from leaking meaningful content.
 */
export const TEASER_FRACTION = 0.1;
export const TEASER_MIN_CHARS = 50;
export const TEASER_MAX_CHARS = 300;

/**
 * Truncation marker appended to every teased value — it ships in the API
 * payload itself so every consumer (UI, SDK, exports, REST) sees "there is
 * more data here" without client-side decoration.
 */
export const TEASER_ELLIPSIS = " …";

const toErrorTeaser = (error: ErrorCapture | null | undefined): ErrorCapture | null | undefined => {
  if (!error) {
    return error;
  }

  // The stacktrace is content too (errors routinely embed prompts) —
  // tease the joined trace, not each frame, so N frames can't leak N teasers.
  const joined = error.stacktrace.join("\n");

  return {
    ...error,
    message: teaserOf(error.message),
    stacktrace: joined ? [teaserOf(joined)] : [],
  };
};

const toSpanIOTeaser = (
  io: LegacySpanInputOutput | null | undefined,
): SpanInputOutput | null | undefined => {
  if (!io) {
    return io;
  }

  // Real-world payloads don't always honor the declared type (e.g. a
  // chat_messages value that isn't an array) — serialize-and-tease those.
  const teaserAsRaw = (): SpanInputOutput => ({
    type: "raw",
    value: teaserOf(typeof io.value === "string" ? io.value : JSON.stringify(io.value ?? null)),
  });
  switch (io.type) {
    case "text":
      return typeof io.value === "string" ? { ...io, value: teaserOf(io.value) } : teaserAsRaw();
    case "chat_messages":
      if (!Array.isArray(io.value)) {
        return teaserAsRaw();
      }
      return {
        ...io,
        value: io.value.map((message) => ({
          ...message,
          content: teaseMessageContent(message.content),
        })),
      };
    case "list":
      if (!Array.isArray(io.value)) {
        return teaserAsRaw();
      }
      return { ...io, value: io.value.map((item) => toSpanIOTeaser(item)!) };
    default:
      // json / raw / guardrail / evaluation results: tease the serialized
      // value and return it as a raw string — the head is where system
      // prompts live, and the cap bounds what escapes.
      return {
        type: "raw",
        value: teaserOf(JSON.stringify(io.value ?? null)),
      };
  }
};

/**
 * Recursively truncates every string value inside an arbitrary structure to
 * the teaser. Used for rich/nested content (ChatRichContent parts, tool-call
 * args, tool results) where content hides below the top level.
 */
const deepTeaseStrings = (value: unknown): unknown => {
  if (typeof value === "string") {
    return teaserOf(value);
  }

  if (Array.isArray(value)) {
    return value.map(deepTeaseStrings);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deepTeaseStrings(v)]),
    );
  }

  return value;
};

/** One chat message's content, teased: a string head, a null passthrough, or a deep walk. */
const teaseMessageContent = <T>(content: T): T => {
  if (typeof content === "string") {
    return teaserOf(content) as T;
  }

  if (content === null || content === undefined) {
    return content;
  }

  // Rich content (ChatRichContent[]): recursively tease every
  // string field — text parts, tool-call args, tool results.
  return deepTeaseStrings(content) as T;
};

/** One span param, teased: strings directly, objects through their serialisation, rest verbatim. */
const teaseParamValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return teaserOf(value);
  }

  if (typeof value === "object" && value !== null) {
    return teaserOf(JSON.stringify(value));
  }

  return value;
};

const toParamsTeaser = (
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  if (!params) {
    return params;
  }

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, teaseParamValue(value)]),
  );
};

export const teaserOf = (text: string): string => {
  const keep = Math.max(
    TEASER_MIN_CHARS,
    Math.min(TEASER_MAX_CHARS, Math.ceil(text.length * TEASER_FRACTION)),
  );

  return text.length <= keep ? text : text.slice(0, keep) + TEASER_ELLIPSIS;
};

/**
 * Redacts a trace's content fields to teasers (pure — returns a copy).
 * Metadata, metrics, timestamps, ids, and evaluations stay untouched:
 * existence and signal are never gated, only content.
 */
export const redactTraceContent = (trace: Trace): Trace => ({
  ...trace,
  input: trace.input ? { ...trace.input, value: teaserOf(trace.input.value) } : trace.input,
  output: trace.output ? { ...trace.output, value: teaserOf(trace.output.value) } : trace.output,
  expected_output: trace.expected_output
    ? {
        ...trace.expected_output,
        value: teaserOf(trace.expected_output.value),
      }
    : trace.expected_output,
  contexts: trace.contexts?.map((context) => ({
    ...context,
    content: teaserOf(
      typeof context.content === "string" ? context.content : JSON.stringify(context.content),
    ),
  })),
  error: toErrorTeaser(trace.error),
  spans: trace.spans?.map(redactSpanContent),
  redacted_by_visibility_window: true,
});

/** Redacts a span's content fields to teasers (pure — returns a copy). */
export const redactSpanContent = <T extends Span>(span: T): T => ({
  ...span,
  input: toSpanIOTeaser(span.input),
  output: toSpanIOTeaser(span.output),
  error: toErrorTeaser(span.error),
  params: toParamsTeaser(span.params as Record<string, unknown> | null),
});

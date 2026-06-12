import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import type {
  ErrorCapture,
  Span,
  SpanInputOutput,
  Trace,
} from "~/server/tracer/types";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Teaser truncation rule: keep the first
 * max(TEASER_MIN_CHARS, min(TEASER_MAX_CHARS, ceil(len * TEASER_FRACTION)))
 * characters of each content field. The floor keeps tiny traces legible as
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

export const teaserOf = (text: string): string => {
  const keep = Math.max(
    TEASER_MIN_CHARS,
    Math.min(TEASER_MAX_CHARS, Math.ceil(text.length * TEASER_FRACTION)),
  );
  return text.length <= keep ? text : text.slice(0, keep) + TEASER_ELLIPSIS;
};

const teaserOfError = (
  error: ErrorCapture | null | undefined,
): ErrorCapture | null | undefined => {
  if (!error) return error;
  // The stacktrace is content too (errors routinely embed prompts) —
  // tease the joined trace, not each frame, so N frames can't leak N teasers.
  const joined = error.stacktrace.join("\n");
  return {
    ...error,
    message: teaserOf(error.message),
    stacktrace: joined ? [teaserOf(joined)] : [],
  };
};

const teaserOfSpanIO = (
  io: SpanInputOutput | null | undefined,
): SpanInputOutput | null | undefined => {
  if (!io) return io;
  // Real-world payloads don't always honor the declared type (e.g. a
  // chat_messages value that isn't an array) — serialize-and-tease those.
  const teaserAsRaw = (): SpanInputOutput => ({
    type: "raw",
    value: teaserOf(
      typeof io.value === "string" ? io.value : JSON.stringify(io.value ?? null),
    ),
  });
  switch (io.type) {
    case "text":
      return typeof io.value === "string"
        ? { ...io, value: teaserOf(io.value) }
        : teaserAsRaw();
    case "chat_messages":
      if (!Array.isArray(io.value)) return teaserAsRaw();
      return {
        ...io,
        value: io.value.map((message) => ({
          ...message,
          content:
            typeof message.content === "string"
              ? teaserOf(message.content)
              : message.content === null || message.content === undefined
                ? message.content
                : // Rich content (ChatRichContent[]): recursively tease every
                  // string field — text parts, tool-call args, tool results.
                  (deepTeaseStrings(
                    message.content,
                  ) as typeof message.content),
        })),
      };
    case "list":
      if (!Array.isArray(io.value)) return teaserAsRaw();
      return { ...io, value: io.value.map((item) => teaserOfSpanIO(item)!) };
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
  if (typeof value === "string") return teaserOf(value);
  if (Array.isArray(value)) return value.map(deepTeaseStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        deepTeaseStrings(v),
      ]),
    );
  }
  return value;
};

const teaserOfParams = (
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  if (!params) return params;
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "string"
        ? teaserOf(value)
        : typeof value === "object" && value !== null
          ? teaserOf(JSON.stringify(value))
          : value,
    ]),
  );
};

/**
 * Redacts a trace's content fields to teasers (pure — returns a copy).
 * Metadata, metrics, timestamps, ids, and evaluations stay untouched:
 * existence and signal are never gated, only content.
 */
export const redactTraceContent = (trace: Trace): Trace => ({
  ...trace,
  input: trace.input ? { ...trace.input, value: teaserOf(trace.input.value) } : trace.input,
  output: trace.output
    ? { ...trace.output, value: teaserOf(trace.output.value) }
    : trace.output,
  expected_output: trace.expected_output
    ? { ...trace.expected_output, value: teaserOf(trace.expected_output.value) }
    : trace.expected_output,
  contexts: trace.contexts?.map((context) => ({
    ...context,
    content: teaserOf(
      typeof context.content === "string"
        ? context.content
        : JSON.stringify(context.content),
    ),
  })),
  error: teaserOfError(trace.error),
  spans: trace.spans?.map(redactSpanContent),
  redacted_by_visibility_window: true,
});

/** Redacts a span's content fields to teasers (pure — returns a copy). */
export const redactSpanContent = <T extends Span>(span: T): T => ({
  ...span,
  input: teaserOfSpanIO(span.input),
  output: teaserOfSpanIO(span.output),
  error: teaserOfError(span.error),
  params: teaserOfParams(span.params as Record<string, unknown> | null),
});

/**
 * Resolves the plan-based visibility cutoff for an organization.
 * Design rationale: dev/docs/adr/028-visibility-blur-teaser-redaction.md.
 *
 * Stateless by design: every call evaluates the CURRENT plan, so upgrades
 * unblur on the next read and downgrades re-blur the same way. Plan-resolution
 * failures PROPAGATE — the caller owns the fail-closed fallback (free-tier
 * window + alert + no caching), so a transient plan-store error is never
 * mistaken for a real plan answer.
 */
export class VisibilityWindowService {
  constructor(private readonly planProvider: PlanProvider) {}

  /**
   * Returns the epoch-ms cutoff before which content must be teased, or
   * `null` when the plan has no visibility window (all paid/licensed plans).
   * Throws when plan resolution fails — callers must fail closed.
   */
  async getVisibilityCutoffMs({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    const plan = await this.planProvider.getActivePlan({ organizationId });
    const visibilityDays = plan?.visibilityDays;
    if (visibilityDays === null || visibilityDays === undefined) return null;
    return Date.now() - visibilityDays * DAY_MS;
  }

  /** True when a trace/span started before the cutoff (content must be teased). */
  isBeyondWindow({
    startedAtMs,
    cutoffMs,
  }: {
    startedAtMs: number;
    cutoffMs: number | null;
  }): boolean {
    return cutoffMs !== null && startedAtMs < cutoffMs;
  }
}

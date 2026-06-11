import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import type {
  ErrorCapture,
  Span,
  SpanInputOutput,
  Trace,
} from "~/server/tracer/types";
import { FREE_VISIBILITY_DAYS } from "../../../../ee/licensing/constants";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:traces:visibility-window");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Teaser truncation rule (ADR-028): keep the first
 * max(TEASER_MIN_CHARS, min(TEASER_MAX_CHARS, ceil(len * TEASER_FRACTION)))
 * characters of each content field. The floor keeps tiny traces legible as
 * teasers; the cap stops large payloads from leaking meaningful content.
 */
export const TEASER_FRACTION = 0.1;
export const TEASER_MIN_CHARS = 50;
export const TEASER_MAX_CHARS = 300;

export const teaserOf = (text: string): string => {
  const keep = Math.max(
    TEASER_MIN_CHARS,
    Math.min(TEASER_MAX_CHARS, Math.ceil(text.length * TEASER_FRACTION)),
  );
  return text.length <= keep ? text : text.slice(0, keep);
};

const teaserOfError = (
  error: ErrorCapture | null | undefined,
): ErrorCapture | null | undefined => {
  if (!error) return error;
  // The stacktrace is content too (ADR-028: errors routinely embed prompts) —
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
  switch (io.type) {
    case "text":
      return { ...io, value: teaserOf(io.value) };
    case "chat_messages":
      return {
        ...io,
        value: io.value.map((message) => ({
          ...message,
          content:
            typeof message.content === "string"
              ? teaserOf(message.content)
              : message.content === null || message.content === undefined
                ? message.content
                : (JSON.parse(
                    JSON.stringify(message.content),
                  ) as typeof message.content),
        })),
      };
    case "list":
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
 * existence and signal are never gated, only content (ADR-028).
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
 * Resolves the plan-based visibility cutoff for an organization (ADR-028).
 *
 * Stateless by design: every call evaluates the CURRENT plan, so upgrades
 * unblur on the next read and downgrades re-blur the same way. Fails CLOSED —
 * if plan resolution throws, the free-tier window applies (a leak is
 * irreversible; over-blur is a refresh away) and the event is logged for
 * alerting.
 */
export class VisibilityWindowService {
  constructor(private readonly planProvider: PlanProvider) {}

  /**
   * Returns the epoch-ms cutoff before which content must be teased, or
   * `null` when the plan has no visibility window (all paid/licensed plans).
   */
  async getVisibilityCutoffMs({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    try {
      const plan = await this.planProvider.getActivePlan({ organizationId });
      const visibilityDays = plan?.visibilityDays;
      if (visibilityDays === null || visibilityDays === undefined) return null;
      return Date.now() - visibilityDays * DAY_MS;
    } catch (error) {
      logger.error(
        { organizationId, error },
        "plan resolution failed — visibility window failing closed to free tier",
      );
      return Date.now() - FREE_VISIBILITY_DAYS * DAY_MS;
    }
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

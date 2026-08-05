import {
  type HandledError,
  handledErrorFromHerr,
} from "@langwatch/handled-error";
import { APICallError, RetryError } from "ai";
import { z } from "zod";

/**
 * nlpgo's handled-error envelope (services/nlpgo herr package). Every
 * handled failure on the Go side arrives as this JSON body, e.g.:
 *
 * ```json
 * {"error":{"type":"bad_request","message":"bad_request",
 *   "meta":{"reason":"missing_provider"},
 *   "reasons":[{"type":"unknown","message":"unknown"}]}}
 * ```
 */
const goErrorEnvelopeSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    fault: z.enum(["customer", "platform", "provider"]).optional(),
    tips: z.array(z.string()).optional(),
    docs_url: z.string().optional(),
  }),
});

/**
 * Maps an AI SDK call failure into a `HandledError` when the
 * upstream response body carries nlpgo's handled-error envelope.
 * Returns null for anything else (network failures, provider errors
 * that aren't envelope-shaped, non-AI-SDK errors) — those stay on the
 * caller's unhandled path.
 *
 * Unwraps the AI SDK's RetryError to the last attempt, since
 * generateObject surfaces exhausted retries that way.
 */
/**
 * True when `error` is an abort — e.g. an `AbortSignal.timeout` cap firing.
 * `AbortSignal.timeout().reason` is a `DOMException` (name "TimeoutError"), not
 * `instanceof Error` in this runtime, so match on the `name` property directly.
 * Mirrors the abort names in `@ai-sdk/provider-utils`' `isAbortError`
 * ("AbortError" / "TimeoutError" / Next.js "ResponseAborted") — kept as a local
 * copy because `ai` doesn't re-export it and provider-utils isn't a direct dep.
 * No `RetryError` unwrap: the AI SDK re-throws aborts RAW before wrapping, so an
 * abort is never a `RetryError.lastError` (verified against ai@6.0.217). Lives
 * here beside `nlpgoHandledErrorFrom` so every `generateObject` caller can share
 * one abort predicate.
 */
export function isAbortLikeError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    name === "ResponseAborted"
  );
}

export function nlpgoHandledErrorFrom(error: unknown): HandledError | null {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause) || !cause.responseBody) {
    return null;
  }

  let body: unknown;
  try {
    body = JSON.parse(cause.responseBody);
  } catch {
    return null;
  }

  const parsed = goErrorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }

  const envelope = parsed.data.error;
  // The most specific discriminant available — `meta.reason` when present
  // (e.g. "missing_provider"), the envelope `type` otherwise.
  const reason = envelope.meta?.reason;
  const code = typeof reason === "string" ? reason : envelope.type;

  return handledErrorFromHerr(
    {
      type: code,
      message: envelope.message ?? envelope.type,
      meta: envelope.meta,
      trace_id: envelope.trace_id,
      span_id: envelope.span_id,
      fault: envelope.fault,
      tips: envelope.tips,
      docs_url: envelope.docs_url,
    },
    { httpStatus: cause.statusCode ?? 500 },
  );
}

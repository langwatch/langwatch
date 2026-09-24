import { type HandledError, handledErrorFromHerr } from "@langwatch/handled-error";
import { APICallError, RetryError } from "ai";
import { z } from "zod";

/**
 * nlpgo error envelope: `fault` is declared optional but never on wire; don't classify on it.
 * See scenario code-agent adapter's `parseErrorEnvelope`.
 */
export const goErrorEnvelopeSchema = z.object({
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
 * Maps AI SDK call failure to HandledError when response carries nlpgo's envelope.
 * Returns null for other failures; unwraps RetryError to last attempt for generateObject.
 */

/**
 * True when error is an abort; e.g., AbortSignal.timeout() — a DOMException.
 * Match on name property. Mirrors @ai-sdk/provider-utils isAbortError.
 */
export function isAbortLikeError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === "AbortError" || name === "TimeoutError" || name === "ResponseAborted";
}

export function extractNlpgoHandledError(error: unknown): HandledError | null {
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

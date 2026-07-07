import { APICallError, RetryError } from "ai";
import { z } from "zod";
import { DomainError } from "../app-layer/domain-error";

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
  }),
});

/**
 * A handled error the Go side (nlpgo / AI Gateway) returned as a typed
 * envelope. `kind` is the most specific discriminant available —
 * `meta.reason` when present (e.g. "missing_provider"), the envelope
 * `type` otherwise (e.g. "bad_request").
 */
export class NlpgoHandledError extends DomainError {
  constructor(
    kind: string,
    message: string,
    options: { httpStatus: number; meta?: Record<string, unknown> },
  ) {
    super(kind, message, options);
    this.name = "NlpgoHandledError";
  }
}

/**
 * Maps an AI SDK call failure into a `NlpgoHandledError` when the
 * upstream response body carries nlpgo's handled-error envelope.
 * Returns null for anything else (network failures, provider errors
 * that aren't envelope-shaped, non-AI-SDK errors) — those stay on the
 * caller's unhandled path.
 *
 * Unwraps the AI SDK's RetryError to the last attempt, since
 * generateObject surfaces exhausted retries that way.
 */
export function nlpgoHandledErrorFrom(error: unknown): NlpgoHandledError | null {
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
  const reason = envelope.meta?.reason;
  const kind = typeof reason === "string" ? reason : envelope.type;

  return new NlpgoHandledError(kind, envelope.message ?? envelope.type, {
    httpStatus: cause.statusCode ?? 500,
    meta: envelope.meta,
  });
}

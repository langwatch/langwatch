import { z } from "zod";

/**
 * Coerces a date value (ISO string or epoch number) to epoch milliseconds.
 */
export function coerceToEpoch(value: string | number): number {
  return typeof value === "string" ? Date.parse(value) : value;
}

/**
 * Zod schema that accepts either an epoch number or a valid ISO date string.
 */
export const flexibleDateSchema = z.union([
  z.number(),
  z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: "Invalid date format",
  }),
]);

/**
 * Schema for successful operation responses
 */
export const successSchema = z.object({ success: z.boolean() });

/**
 * The canonical REST error envelope.
 *
 * One shape for every refusal the API can answer with, so a caller writes one
 * reader:
 *
 *     { "error": { "type": "bad_request",
 *                  "code": "validation_error",
 *                  "message": "The query parameters didn't match the expected shape.",
 *                  "meta": { "target": "query", "fields": ["from"] } } }
 *
 * `type` is the status CLASS, derived from the HTTP status and drawn from a
 * closed set ({@link API_ERROR_TYPE_BY_STATUS}); it is the OpenAI-compatible
 * discriminant provider SDKs already branch on. `code` is the specific,
 * stable machine name for what happened, and is the field to branch on.
 * `message` is a sentence for a human, never parsed. `meta` carries the
 * structured detail the sentence deliberately leaves out.
 *
 * Keys inside `meta` are lower_snake_case, matching the rest of the wire.
 *
 * The Go data plane emits the same envelope from `pkg/herr` and additionally
 * carries `tips`, `docs_url` and `fault` on its 402; a consumer that reads
 * only these four fields works against both planes.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    type: z.string(),
    code: z.string(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    /**
     * Correlation handles for the failing request, present when the request
     * was traced. Same field names and semantics as `herr.ErrorBody`, so a
     * failure can be quoted to support identically whichever plane answered.
     */
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * The status class each HTTP status reports as `error.type`. A status with no
 * entry reports {@link FALLBACK_API_ERROR_TYPE}.
 */
export const API_ERROR_TYPE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "permission_denied",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  422: "unprocessable_entity",
  429: "rate_limited",
};

export const FALLBACK_API_ERROR_TYPE = "internal_error";

/** The `error.type` for a status, closed-set with an internal_error fallback. */
export function apiErrorType(status: number): string {
  return API_ERROR_TYPE_BY_STATUS[status] ?? FALLBACK_API_ERROR_TYPE;
}

/**
 * Builds the canonical envelope. `type` is derived from the status so a route
 * cannot invent a class, and empty `meta` is omitted rather than sent as `{}`.
 */
export function apiErrorBody({
  status,
  code,
  message,
  meta,
  traceId,
  spanId,
}: {
  status: number;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
}): ApiErrorBody {
  return {
    error: {
      type: apiErrorType(status),
      code,
      message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
      ...(spanId ? { span_id: spanId } : {}),
    },
  };
}

/**
 * The pre-canonical flat error shape, `{ error: "<sentence>", message? }`.
 *
 * Still the wire shape of the route families that predate the canonical
 * envelope, and of the client readers written against them
 * (`~/features/errors/logic/readHandledError`). New routes must use
 * {@link apiErrorSchema}; this exists so the existing families keep answering
 * exactly what their published consumers already parse.
 */
export const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

/**
 * Schema for unauthorized error responses
 */
export const unauthorizedSchema = errorSchema;

/**
 * Schema for bad request error responses
 */
export const badRequestSchema = errorSchema;

/**
 * Schema for conflict error responses
 */
export const conflictSchema = errorSchema.extend({
  message: z.string(),
});

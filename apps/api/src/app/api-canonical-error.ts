/**
 * Turning any thrown value into the canonical REST error envelope.
 */
import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { type ApiErrorBody, apiErrorBody, requestTraceIds } from "@langwatch/api/rest";

/**
 * The code for a refusal that only knows its status. `HttpError` carries a status and a
 * sentence but no machine name, so without this a caller branching on `error.code` would
 * get nothing to branch on.
 */
const CODE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  422: "unprocessable_entity",
  429: "rate_limited",
};

const FALLBACK_ERROR_CODE = "internal_error";

/**
 * What a 5xx says out loud. An unexpected failure's message names Prisma models, SQL,
 * hosts and stack fragments. None of that is API copy, and the structured trace ids
 * carried alongside are the correlation channel that replaces it.
 */
const INTERNAL_ERROR_MESSAGE = "An unknown error occurred";

/**
 * Request validation answers 400, not 422. The shared validator raises `validation_error`
 * at 422 for the route families that predate the canonical envelope.
 */
const VALIDATION_ERROR_CODE = "validation_error";
const VALIDATION_ERROR_STATUS = 400;

/**
 * One link in `meta.reasons`, in the wire's own casing. `HandledError.serialize()` is
 * written for the app's own client and emits camelCase plus a deprecated `kind` alias.
 */
export interface ApiErrorReason {
  code: string;
  message: string;
  retryable: boolean;
  meta?: Record<string, unknown>;
}

function reasonsOf(error: unknown): ApiErrorReason[] {
  if (!HandledError.isHandled(error)) return [];
  return error.serialize().reasons.map((reason) => ({
    code: reason.code,
    message: typeof reason.meta?.message === "string" ? reason.meta.message : reason.code,
    retryable: reason.retryable,
    ...(reason.meta && Object.keys(reason.meta).length > 0 ? { meta: reason.meta } : {}),
  }));
}

/**
 * A status-carrying REST error, recognised by its shape rather than by its class. There
 * are two `HttpError` trees while the REST families move into `@langwatch/platform-api`:
 * the application's own, and the packaged one a moved family throws.
 */
function isStatusCarryingError(
  error: unknown,
): error is Error & { status: ContentfulStatusCode; error: string } {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { error?: unknown }).error === "string"
  );
}

/**
 * The canonical body and status for any thrown value.
 */
export function canonicalErrorFor(
  error: unknown,
  trace?: { traceId?: string; spanId?: string },
): { status: ContentfulStatusCode; body: ApiErrorBody } {
  const traceIds = { traceId: trace?.traceId, spanId: trace?.spanId };

  if (HandledError.isHandled(error)) {
    return handledErrorEnvelope(error, traceIds);
  }

  if (isStatusCarryingError(error)) {
    const status = error.status;
    return {
      status,
      body: apiErrorBody({
        status,
        code: CODE_BY_STATUS[status] ?? FALLBACK_ERROR_CODE,
        message: status >= 500 ? INTERNAL_ERROR_MESSAGE : error.message,
        ...traceIds,
      }),
    };
  }

  return {
    status: 500,
    body: apiErrorBody({
      status: 500,
      code: FALLBACK_ERROR_CODE,
      message: INTERNAL_ERROR_MESSAGE,
      ...traceIds,
    }),
  };
}

/**
 * The envelope for a handled error: its own code, status, meta, and reason chain below
 * 5xx; the opaque body at 5xx. A HandledError's message is customer-safe by construction
 * (ADR-045), but customer-safe and caller-actionable are different questions.
 */
function handledErrorEnvelope(
  error: HandledError,
  traceIds: { traceId?: string; spanId?: string },
): { status: ContentfulStatusCode; body: ApiErrorBody } {
  const isValidation = error.code === VALIDATION_ERROR_CODE;
  const status = (
    isValidation ? VALIDATION_ERROR_STATUS : (error.httpStatus ?? 500)
  ) as ContentfulStatusCode;

  if (status >= 500) {
    return {
      status,
      body: apiErrorBody({
        status,
        code: FALLBACK_ERROR_CODE,
        message: INTERNAL_ERROR_MESSAGE,
        retryable: error.retryable,
        ...traceIds,
      }),
    };
  }

  const reasons = reasonsOf(error);
  return {
    status,
    body: apiErrorBody({
      status,
      code: error.code,
      message: error.message ?? "",
      retryable: error.retryable,
      meta: {
        ...error.meta,
        ...(reasons.length > 0 ? { reasons } : {}),
      },
      ...traceIds,
    }),
  };
}

/** Answers `error` as the canonical envelope, with the request's trace ids. */
export function canonicalErrorResponse(error: unknown, c: Context): Response {
  const { status, body } = canonicalErrorFor(error, requestTraceIds(c));
  return c.json(body, status);
}

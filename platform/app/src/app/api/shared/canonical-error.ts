/**
 * Turning any thrown value into the canonical REST error envelope.
 *
 * The envelope itself is defined once in `./schemas` ({@link apiErrorSchema});
 * this module is the single place that decides, for every kind of error the
 * boundary can see, which `code`, which status and which `meta` it answers
 * with. Route families share it so two surfaces cannot drift into two
 * taxonomies for the same failure.
 */
import { HandledError } from "@langwatch/handled-error";
import { INVALID_TRACE_ID } from "@langwatch/observability/constants";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { HttpError } from "./errors";
import { type ApiErrorBody, apiErrorBody } from "./schemas";

const INVALID_SPAN_ID = "0".repeat(16);

/**
 * The code for a refusal that only knows its status.
 *
 * `HttpError` carries a status and a sentence but no machine name, so without
 * this a caller branching on `error.code` would get nothing to branch on. The
 * values are the status names in the same lower_snake_case as every other
 * code on the wire.
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
 * What a 5xx says out loud.
 *
 * An unexpected failure's message names Prisma models, SQL, hosts and stack
 * fragments. None of that is API copy, and the structured trace ids carried
 * alongside are the correlation channel that replaces it.
 */
const INTERNAL_ERROR_MESSAGE = "An unknown error occurred";

/**
 * Request validation answers 400, not 422.
 *
 * The shared validator raises `validation_error` at 422 for the route families
 * that predate the canonical envelope. Those two statuses for one code is the
 * divergence this collapses: a caller reconciling spend should not have to
 * learn that a bad `from` is 422 here and 400 on the platform routes.
 */
const VALIDATION_ERROR_CODE = "validation_error";
const VALIDATION_ERROR_STATUS = 400;

/**
 * One link in `meta.reasons`, in the wire's own casing.
 *
 * `HandledError.serialize()` is written for the app's own client and emits
 * camelCase plus a deprecated `kind` alias. Neither belongs on a public
 * envelope whose every other key is lower_snake_case, so the fields a caller
 * can act on are re-read here and the rest dropped.
 */
export interface ApiErrorReason {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

function reasonsOf(error: unknown): ApiErrorReason[] {
  if (!HandledError.isHandled(error)) return [];
  return error.serialize().reasons.map((reason) => ({
    code: reason.code,
    message:
      typeof reason.meta?.message === "string"
        ? reason.meta.message
        : reason.code,
    ...(reason.meta && Object.keys(reason.meta).length > 0
      ? { meta: reason.meta }
      : {}),
  }));
}

/** An all-zero id is OpenTelemetry's "no valid span" sentinel: treat as absent. */
function liveId(id: unknown, zero: string): string | undefined {
  return typeof id === "string" && id && id !== zero ? id : undefined;
}

/** The request's trace correlation handles, as set by the tracer middleware. */
export function requestTraceIds(c: Context): {
  traceId?: string;
  spanId?: string;
} {
  return {
    traceId: liveId(c.get("traceId"), INVALID_TRACE_ID),
    spanId: liveId(c.get("spanId"), INVALID_SPAN_ID),
  };
}

/**
 * The canonical body and status for any thrown value.
 *
 * Exported separately from {@link canonicalErrorResponse} so a caller that
 * already holds a `Context` (a middleware answering a denial itself) and a
 * caller that has only the error (a test, a log line) read the same mapping.
 */
export function canonicalErrorFor(
  error: unknown,
  trace?: { traceId?: string; spanId?: string },
): { status: ContentfulStatusCode; body: ApiErrorBody } {
  const traceIds = { traceId: trace?.traceId, spanId: trace?.spanId };

  if (HandledError.isHandled(error)) {
    return handledErrorEnvelope(error, traceIds);
  }

  if (error instanceof HttpError) {
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
 * The envelope for a handled error: its own code, status, meta, and reason
 * chain — at ANY status, including 5xx.
 *
 * A HandledError's message is customer-safe by construction (ADR-045: thrown
 * only when "the cause is both known and user-relevant"), so a platform
 * failure like `lwql_unavailable` (503) ships its real code and message the
 * same as a 404 would; collapsing it to the generic body would throw away
 * the one piece of information ("this deployment doesn't have LangWatchQL
 * provisioned, retrying won't help") the class exists to carry. Only a
 * genuinely unhandled error — `HttpError` and the final fallback below, which
 * carry no such guarantee — stays opaque at 5xx. Mirrors the legacy Hono
 * handler's `handledErrorResponseBody`
 * (`src/app/api/middleware/error-handler.ts`), which never special-cased
 * status for a HandledError either.
 */
function handledErrorEnvelope(
  error: HandledError,
  traceIds: { traceId?: string; spanId?: string },
): { status: ContentfulStatusCode; body: ApiErrorBody } {
  const isValidation = error.code === VALIDATION_ERROR_CODE;
  const status = (
    isValidation ? VALIDATION_ERROR_STATUS : (error.httpStatus ?? 500)
  ) as ContentfulStatusCode;

  const reasons = reasonsOf(error);
  return {
    status,
    body: apiErrorBody({
      status,
      code: error.code,
      message: error.message ?? "",
      meta: {
        ...(error.meta ?? {}),
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

/**
 * Which error shape a route family publishes.
 *
 * `canonical` is what new families use. `legacy` is the flat
 * `{ error: "<sentence>", message? }` the families that predate the envelope
 * already published, and which their consumers parse; it stays until a family
 * migrates on purpose, because the shape is part of its contract.
 */
export type ApiErrorEnvelope = "legacy" | "canonical";

/**
 * A refusal body builder for one family's envelope.
 *
 * Middleware that answers a denial itself sits UNDER the family's error
 * handler, so it has to render the shape the family publishes rather than
 * assume one. Taking the choice once, at construction, keeps the decision out
 * of every call site.
 */
export function authRefusalBody(
  envelope: ApiErrorEnvelope,
): (args: {
  status: number;
  code: string;
  legacyError: string;
  message: string;
  meta?: Record<string, unknown>;
}) => object {
  return ({ status, code, legacyError, message, meta }) =>
    envelope === "canonical"
      ? apiErrorBody({ status, code, message, meta })
      : { error: legacyError, message };
}

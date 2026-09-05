import { HandledError } from "@langwatch/handled-error";
import {
  apiErrorBody,
  loggerMiddleware,
  tracerMiddleware,
  type ApiErrorBody,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiRestSecurityObservability } from "../api-rest.security";

const logger = createLogger("langwatch:api:rest");

const UNKNOWN_ERROR_MESSAGE = "An unknown error occurred";

/**
 * The machine name for a framework refusal, which carries a status and a
 * sentence but no code of its own. Without this a caller branching on the
 * code would get `internal_error` for a plain 404.
 */
const CODE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  413: "payload_too_large",
  422: "unprocessable_entity",
  429: "rate_limited",
};

/**
 * The observability and error-rendering half of the API process's REST enforcement.
 */
export class ApiRestObservabilityComposition {
  static create(): ApiRestSecurityObservability {
    return {
      // The API process composes its services at boot and closes over them, so
      // there is no per-request container to install. The port stays because
      // the framework mounts it on every family; a process that resolves its
      // application per request puts that here.
      appContext: passThrough,
      requestLogger: () => loggerMiddleware({ name: "langwatch:api:rest" }),
      requestTracer: ({ name }) => tracerMiddleware({ name }),
      legacyErrorHandler: renderLegacy,
      canonicalErrorHandler: renderCanonical,
    };
  }
}

const passThrough: MiddlewareHandler = async (_context, next) => {
  await next();
};

/**
 * The flat body, built by {@link legacyErrorBody}. Everything unhandled
 * collapses to a generic 500 — an unanticipated failure must never put its
 * own message in front of a caller.
 */
const renderLegacy: ErrorHandler = (error, context) => {
  const status = statusOf(error);
  log(error, context, status);

  if (HandledError.isHandled(error)) {
    return context.json(legacyErrorBody(error), status);
  }
  if (error instanceof HTTPException && status < 500) {
    return context.json({ error: error.message, message: error.message }, status);
  }
  return context.json({ error: "Internal Server Error", message: UNKNOWN_ERROR_MESSAGE }, status);
};

/**
 * A handled refusal as the flat legacy body, WITHOUT writing a response.
 */
export function legacyErrorBody(error: HandledError): Record<string, unknown> {
  const label = "legacyError" in error ? (error.legacyError as string) : error.code;
  const { tips, docsUrl, fault, reasons } = error.serialize();
  return {
    error: label,
    message: error.message,
    ...error.meta,
    // The remediation channel an agent or CLI reads when it has no
    // presentation registry, and the cause chain a multi-fact refusal IS — a
    // schema failure's whole payload is one reason per offending field.
    // `serialize` masks a non-handled cause, so nothing internal rides out.
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    fault,
    ...(reasons.length > 0 ? { reasons } : {}),
  };
}

/**
 * The canonical envelope, built by the package's own `apiErrorBody` so `type` is derived
 * from the status rather than invented here.
 */
const renderCanonical: ErrorHandler = (error, context) => {
  const status = statusOf(error);
  log(error, context, status);
  return context.json(canonicalErrorFor(error).body, status);
};

/**
 * Any thrown value as the canonical envelope, WITHOUT writing a response. The two callers
 * want different things from one mapping.
 */
export function canonicalErrorFor(error: unknown): {
  status: ContentfulStatusCode;
  body: ApiErrorBody;
} {
  const status = statusOf(error as Error);
  const body: ApiErrorBody = HandledError.isHandled(error)
    ? apiErrorBody({
        status,
        code: error.code,
        message: error.message,
        meta: error.meta,
        retryable: error.retryable,
        ...(error.traceId ? { traceId: error.traceId } : {}),
        ...(error.spanId ? { spanId: error.spanId } : {}),
      })
    : apiErrorBody({
        status,
        code:
          error instanceof HTTPException && status < 500
            ? (CODE_BY_STATUS[status] ?? "internal_error")
            : "internal_error",
        message:
          error instanceof HTTPException && status < 500 ? error.message : UNKNOWN_ERROR_MESSAGE,
      });
  return { status, body };
}

/**
 * The status a thrown value answers with. A framework refusal carries its own,
 * and the boundary must not flatten it: a handler's 404 answered as a 500 tells
 * the caller the platform broke when their own request merely missed.
 */
function statusOf(error: Error): ContentfulStatusCode {
  if (HandledError.isHandled(error)) return error.httpStatus as ContentfulStatusCode;
  if (error instanceof HTTPException) return error.status;
  return 500;
}

/**
 * A refusal the caller can act on is their fact, not our outage — logging a
 * 404 or a 422 at error level buries the real failures under routine ones.
 */
function log(error: Error, context: Context, status: number): void {
  const level = status >= 500 ? "error" : "warn";
  logger[level](
    {
      path: context.req.path,
      method: context.req.method,
      status,
      error: { name: error.name, message: error.message, stack: error.stack },
    },
    `REST error [${status}]: ${error.message || String(error)}`,
  );
}

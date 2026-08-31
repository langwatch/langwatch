import { HandledError } from "@langwatch/handled-error";
import {
  apiErrorBody,
  loggerMiddleware,
  tracerMiddleware,
  type ApiErrorBody,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiRestSecurityObservability } from "../api-rest.security";

const logger = createLogger("langwatch:api:rest");

/**
 * The observability and error-rendering half of the API process's REST
 * enforcement.
 *
 * Split from {@link ApiRestSecurity} because these five are the process's
 * rather than the credential's: a logger and a tracer belong to the running
 * process, and both error shapes render the application's own taxonomy. The
 * security class answers "who is this caller"; this one answers "how does
 * this process talk".
 *
 * The two error shapes are not interchangeable. `legacy` is the flat
 * `{ error, message }` the families that predate the envelope already publish
 * and whose consumers parse it; `canonical` is the enveloped
 * `{ error: { code, message, ... } }` new families use. A family picks one
 * deliberately, and this composition renders whichever it picked.
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
 * The flat body: `{ error: "<label>", message }` plus whatever `meta` the
 * error carried. Everything unhandled collapses to a generic 500 — an
 * unanticipated failure must never put its own message in front of a caller.
 */
const renderLegacy: ErrorHandler = (error, context) => {
  const status = statusOf(error);
  log(error, context, status);

  if (HandledError.isHandled(error)) {
    const label = "legacyError" in error ? error.legacyError : error.code;
    return context.json({ error: label, message: error.message, ...error.meta }, status);
  }
  return context.json(
    { error: "Internal Server Error", message: "An unknown error occurred" },
    500,
  );
};

/**
 * The canonical envelope, built by the package's own `apiErrorBody` so `type`
 * is derived from the status rather than invented here. A handled error
 * publishes its code, message, `meta` and retryability; an unhandled one
 * publishes `internal_error` and nothing about itself, with the correlation
 * handles as the only thread back to what actually happened.
 */
const renderCanonical: ErrorHandler = (error, context) => {
  const status = statusOf(error);
  log(error, context, status);

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
        code: "internal_error",
        message: "An unknown error occurred",
      });

  return context.json(body, status);
};

function statusOf(error: Error): ContentfulStatusCode {
  return HandledError.isHandled(error) ? (error.httpStatus as ContentfulStatusCode) : 500;
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

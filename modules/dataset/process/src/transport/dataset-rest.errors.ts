import { errorSchema, HttpError, InternalServerError } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { getLogLevelForRequest } from "@langwatch/observability/request";
import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const logger = createLogger("langwatch:api:dataset:errors");

/** Domain errors → HTTP status/code mapping. Handled errors not listed
 * (they know their own status, code, fault, remediation).
 */
const DOMAIN_ERROR_HTTP: Record<string, { status: ContentfulStatusCode; code: string }> = {
  DatasetNotFoundError: { status: 404, code: "NotFound" },
  DatasetConflictError: { status: 409, code: "Conflict" },
  UploadNotPendingError: { status: 409, code: "Conflict" },
  DatasetNotRetryableError: { status: 409, code: "Conflict" },
  // I-READY: a still-preparing dataset is 425 Too Early, matching tRPC's
  // PRECONDITION_FAILED and `mapDatasetNotReadyError`. This is the global
  // safety net so a propagated error (e.g. an upload racing an in-flight
  // normalize) returns 425, not a 500 that pages on-call for a normal race.
  DatasetNotReadyError: { status: 425, code: "DatasetNotReady" },
  // A PATCH that changes columnTypes on an s3_jsonl dataset is a client request
  // error, not a server fault — 400, matching the tRPC layer's BAD_REQUEST.
  ColumnTypeChangeNotSupportedError: {
    status: 400,
    code: "ColumnTypeChangeNotSupported",
  },
  // A batch carrying a duplicate caller-supplied row id is a client conflict.
  DuplicateRecordIdError: { status: 409, code: "DuplicateRecordId" },
  // A single chunk exceeding the read cap is a server-side corruption/limit
  // signal, but surfaced to the client as 400 (the request can't be served as
  // shaped); a dataset too large to export whole is 413 Payload Too Large.
  ChunkTooLargeError: { status: 400, code: "ChunkTooLarge" },
  DatasetTooLargeToExportError: {
    status: 413,
    code: "DatasetTooLargeToExport",
  },
  DatasetTooLargeToEditColumnsError: {
    status: 413,
    code: "DatasetTooLargeToEditColumns",
  },
};

/** Dataset onError handler: family domain mapping layered over boundary. */
export function createDatasetErrorHandler(options: {
  boundaryErrorHandler: ErrorHandler;
}): ErrorHandler {
  const { boundaryErrorHandler } = options;

  return async (rawError, c: Context): Promise<Response> => {
    const error = rawError as Error & { status?: ContentfulStatusCode };
    const path = c.req.path;
    const method = c.req.method;
    const routeParams = c.req.param();
    // Resolve domain mapping first for logging consistency (known gap: handled
    // errors log at wrong level; see KNOWN GAP below).
    const domain = DOMAIN_ERROR_HTTP[error.name];
    const status =
      domain?.status ?? (error instanceof HttpError ? error.status : (error.status ?? 500));

    // Level with the shared rule rather than a local one, so this boundary
    // agrees with tRPC and the request middleware: a handled error levels by
    // its own fault attribution, anything else by the status we are about to
    // answer with. A 4xx here is the caller's mistake answered correctly — a
    // missing dataset, a bad payload — and only a 5xx is ours.
    logger[getLogLevelForRequest(error, status)](
      {
        path,
        method,
        routeParams,
        status,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      `Dataset API Error [${status}]: ${error.message || String(error)}`,
    );

    // Map known domain errors to their HTTP status + code.
    if (domain) {
      return c.json(
        errorSchema.parse({ error: domain.code, message: error.message }),
        domain.status,
      );
    }

    // Handle HttpError instances (our typed errors)
    if (error instanceof HttpError) {
      return c.json(errorSchema.parse(error), error.status);
    }

    // Default to 500: a handled error already knows its status, code, meta
    // and remediation, so collapsing here would report the caller's mistake
    // as our outage. This adds domain mapping on the shared boundary;
    // anything not claimed here falls through to it.
    if (HandledError.isHandled(error)) {
      return (await boundaryErrorHandler(error, c)) as Response;
    }

    const internalError = new InternalServerError();
    return c.json(errorSchema.parse(internalError), internalError.status);
  };
}

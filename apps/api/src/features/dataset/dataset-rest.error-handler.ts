import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { getLogLevelForRequest } from "@langwatch/observability/request";
import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { errorSchema, HttpError, InternalServerError } from "../../app-rest";

const logger = createLogger("langwatch:api:dataset:errors");

/**
 * Framework-agnostic dataset domain errors (see `@langwatch/dataset-contract`) →
 * their HTTP status + wire `error` code. The service layer throws typed domain
 * errors with no knowledge of HTTP; the route layer owns this mapping. Routes
 * that let these propagate to `onError` (the direct-upload family) get one
 * consistent translation here instead of repeating `error.name === "X"` ladders
 * inline. `message` is always carried through from the thrown error.
 *
 * Handled errors are NOT listed here. They already know their own status, code,
 * fault and remediation, and the boundary handler at the bottom of this file
 * answers with all of it; a domain entry would flatten that back into a bare
 * `{ error, message }`. `StorageNotWritableError` is the one that used to be
 * here and is now handled (`storage_not_writable`).
 */
const DOMAIN_ERROR_HTTP: Record<string, { status: ContentfulStatusCode; code: string }> = {
  DatasetNotFoundError: { status: 404, code: "NotFound" },
  DatasetConflictError: { status: 409, code: "Conflict" },
  UploadNotPendingError: { status: 409, code: "Conflict" },
  DatasetNotRetryableError: { status: 409, code: "Conflict" },
  // Reading/appending a still-preparing dataset (I-READY): 425 Too Early,
  // matching the tRPC layer's PRECONDITION_FAILED and the explicit
  // `mapDatasetNotReadyError` the read routes use. This is the global safety
  // net so a route that lets the error propagate (e.g. POST /:slugOrId/upload
  // racing an in-flight normalize) returns 425, not a 500 that pages on-call
  // for a normal user-induced race.
  DatasetNotReadyError: { status: 425, code: "DatasetNotReady" },
  DirectUploadUnavailableError: {
    status: 409,
    code: "DirectUploadUnavailable",
  },
  UploadTooLargeError: { status: 400, code: "UploadTooLarge" },
  StagedUploadNotFoundError: { status: 422, code: "UploadNotFound" },
  StorageNotWritableError: { status: 500, code: "StorageNotWritable" },
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

/**
 * `onError` for the dataset family, layered over the process's own boundary.
 *
 * The boundary handler is supplied rather than imported: it renders handled
 * errors, Prisma refusals and the trace block out of the application's error
 * taxonomy, which does not belong in a transport package. This handler adds the
 * family's domain mapping on top of it and delegates everything it has not
 * specifically claimed.
 */
export function createDatasetErrorHandler(options: {
  boundaryErrorHandler: ErrorHandler;
}): ErrorHandler {
  const { boundaryErrorHandler } = options;

  return async (rawError, c: Context): Promise<Response> => {
    const error = rawError as Error & { status?: ContentfulStatusCode };
    const path = c.req.path;
    const method = c.req.method;
    const routeParams = c.req.param();
    // Resolve the domain mapping first so the logged status matches the response
    // status: domain errors are plain `Error`s with no `.status`, so computing
    // status from `HttpError`/`.status` alone would log [500] while actually
    // returning 404/409/422.
    //
    // KNOWN GAP, carried over unchanged: a handled error names its status
    // `httpStatus`, which this expression does not read, so a handled 404 is
    // logged as a 500 incident while the caller is correctly told 404. Changing
    // it here would alter the log level of every handled dataset failure, which
    // is not a transport move's business.
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

    // Map known domain errors to their HTTP status + code (the direct-upload
    // routes rely on this instead of catching each one inline).
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

    // Default to 500 for unexpected errors
    // A handled error already knows its own status, code, meta, reasons and
    // remediation — collapsing it to a 500 here would throw all of that away and
    // report the caller's mistake as our outage. This handler exists to add the
    // family's domain mapping on top of the shared boundary, not to replace it,
    // so anything it has not specifically claimed goes to the boundary handler.
    if (HandledError.isHandled(error)) {
      return (await boundaryErrorHandler(error, c)) as Response;
    }

    const internalError = new InternalServerError();
    return c.json(errorSchema.parse(internalError), internalError.status);
  };
}

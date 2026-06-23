import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createLogger } from "../../../../utils/logger/server";
import { HttpError, InternalServerError } from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:dataset:errors");

/**
 * Framework-agnostic dataset domain errors (see `server/datasets/errors.ts`) →
 * their HTTP status + wire `error` code. The service layer throws typed domain
 * errors with no knowledge of HTTP; the route layer owns this mapping. Routes
 * that let these propagate to `onError` (the direct-upload family) get one
 * consistent translation here instead of repeating `error.name === "X"` ladders
 * inline. `message` is always carried through from the thrown error.
 */
const DOMAIN_ERROR_HTTP: Record<
  string,
  { status: ContentfulStatusCode; code: string }
> = {
  DatasetNotFoundError: { status: 404, code: "NotFound" },
  DatasetConflictError: { status: 409, code: "Conflict" },
  UploadNotPendingError: { status: 409, code: "Conflict" },
  DatasetNotRetryableError: { status: 409, code: "Conflict" },
  DirectUploadUnavailableError: {
    status: 409,
    code: "DirectUploadUnavailable",
  },
  UploadTooLargeError: { status: 400, code: "UploadTooLarge" },
  StagedUploadNotFoundError: { status: 422, code: "UploadNotFound" },
  StorageNotWritableError: { status: 500, code: "StorageNotWritable" },
};

/**
 * Error handler for dataset API routes.
 * Converts thrown errors to proper error responses matching the errorSchema.
 */
export const handleDatasetError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const path = c.req.path;
  const method = c.req.method;
  const routeParams = c.req.param();
  // Resolve the domain mapping first so the logged status matches the response
  // status: domain errors are plain `Error`s with no `.status`, so computing
  // status from `HttpError`/`.status` alone would log [500] while actually
  // returning 404/409/422.
  const domain = DOMAIN_ERROR_HTTP[error.name];
  const status =
    domain?.status ??
    (error instanceof HttpError ? error.status : (error.status ?? 500));

  // Log the error with context (including status code)
  logger.error(
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
  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};

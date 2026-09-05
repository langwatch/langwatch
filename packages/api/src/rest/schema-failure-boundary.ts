import { isZodLikeError } from "@langwatch/handled-error";
import type { ErrorHandler } from "hono";

import { validationErrorFromZod } from "../errors.js";

/**
 * Wraps a family's `onError` so a schema rejection reaches it as the
 * `ValidationError` it is.
 *
 * The endpoint pipeline raises a request-schema failure as a bare zod-shaped
 * error, which carries neither `httpStatus` nor `fault`. Only
 * `createErrorHandler` promotes it; a family whose boundary is the process's
 * own renderer therefore answered 500 for a request the raw family answered
 * 422 for. Promoting here keeps the status, the `validation_error` code and
 * the per-field reasons whichever boundary the family installs.
 */
export function promoteSchemaFailures(inner: ErrorHandler): ErrorHandler {
  return (error, c) => inner(isZodLikeError(error) ? validationErrorFromZod(error) : error, c);
}

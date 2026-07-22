import { TRPCError } from "@trpc/server";
import {
  ColumnTypeChangeNotSupportedError,
  DatasetConflictError,
  DatasetNameTakenError,
  DatasetNotFoundError,
  DatasetNotReadyError,
} from "./errors";

/**
 * Middleware function that catches domain errors and maps them to tRPC errors.
 * Can be used as a wrapper function or as tRPC middleware.
 */
export async function withDatasetErrorHandling<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DatasetNotFoundError) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }

    // A name clash is knowable and the caller can act on it, so it crosses the
    // boundary as a handled code rather than prose the client has to match on
    // (ADR-045). `message` here is server copy; the customer-facing words live
    // in the client's presentation registry under `dataset_name_taken`.
    if (error instanceof DatasetConflictError) {
      throw new DatasetNameTakenError();
    }

    // A column-type change on an s3_jsonl dataset is a user-actionable
    // precondition (deferred feature), not a server fault — surface a 4xx with
    // the message instead of a generic 500.
    if (error instanceof ColumnTypeChangeNotSupportedError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
        cause: error,
      });
    }

    // Editing a not-yet-ready dataset (defense-in-depth ready-gate) — same code
    // the record routes use for DatasetNotReadyError.
    if (error instanceof DatasetNotReadyError) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: error.message,
        cause: error,
      });
    }

    // Re-throw unknown errors
    throw error;
  }
}

/**
 * tRPC middleware that wraps handler execution to catch and map dataset domain errors.
 * Usage: procedure.use(datasetErrorHandler)
 */
export const datasetErrorHandler = async <T>({
  next,
}: {
  next: () => Promise<T>;
}): Promise<T> => {
  return await withDatasetErrorHandling(next);
};

import { TRPCError } from "@trpc/server";
import {
  DatasetConflictError,
  DatasetNameTakenError,
  DatasetNotFoundError,
  DatasetStaleColumnsError,
} from "./errors";

/**
 * Catches the dataset domain errors that still need translating at the tRPC
 * boundary and re-raises them as the error the client contract expects.
 *
 * Most of the family needs nothing here: `DatasetNotReadyError` and
 * `ColumnTypeChangeNotSupportedError` are `HandledError`s in their own right,
 * so they carry their code, status and meta across the boundary untouched.
 * What is left is the ambiguous one — a `DatasetConflictError` is two different
 * failures wearing one class — plus the not-found case that has no handled form
 * yet.
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

    // Both conflicts are knowable and both are actionable, but not by the same
    // action — a name clash is fixed by renaming, a stale editor by reloading.
    // Collapsing them onto one code told the second caller to pick a different
    // name, which could never resolve their failure (ADR-045). `message` here
    // is server copy; the customer-facing words live in the client's
    // presentation registry, keyed by these codes.
    if (error instanceof DatasetConflictError) {
      throw error.reason === "stale_columns"
        ? new DatasetStaleColumnsError()
        : new DatasetNameTakenError();
    }

    // Re-throw unknown errors
    throw error;
  }
}

/**
 * tRPC middleware that wraps handler execution to catch and translate dataset
 * domain errors. Usage: procedure.use(datasetErrorHandler)
 */
export const datasetErrorHandler = async <T>({
  next,
}: {
  next: () => Promise<T>;
}): Promise<T> => {
  return await withDatasetErrorHandling(next);
};

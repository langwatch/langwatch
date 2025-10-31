import { TRPCError } from "@trpc/server";
import { DatasetNotFoundError, DatasetConflictError } from "./errors";

/**
 * Middleware function that catches domain errors and maps them to tRPC errors.
 * Can be used as a wrapper function or as tRPC middleware.
 */
export async function withDatasetErrorHandling<T>(
  operation: () => Promise<T>
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

    if (error instanceof DatasetConflictError) {
      throw new TRPCError({
        code: "CONFLICT",
        message: error.message,
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



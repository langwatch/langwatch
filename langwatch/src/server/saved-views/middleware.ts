import { TRPCError } from "@trpc/server";
import { SavedViewNotFoundError, SavedViewReorderError } from "./errors";

/**
 * Middleware function that catches domain errors and maps them to tRPC errors.
 * Can be used as a wrapper function or as tRPC middleware.
 */
export const withSavedViewErrorHandling = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }

    if (error instanceof SavedViewReorderError) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }

    // Re-throw unknown errors
    throw error;
  }
};

/**
 * tRPC middleware that wraps handler execution to catch and map saved view domain errors.
 * Usage: procedure.use(savedViewErrorHandler)
 */
export const savedViewErrorHandler = async <T>({
  next,
}: {
  next: () => Promise<T>;
}): Promise<T> => {
  return await withSavedViewErrorHandling(next);
};

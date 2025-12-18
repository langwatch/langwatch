import { TRPCError } from "@trpc/server";
import { DashboardNotFoundError, DashboardReorderError } from "./errors";

/**
 * Middleware function that catches domain errors and maps them to tRPC errors.
 * Can be used as a wrapper function or as tRPC middleware.
 */
export const withDashboardErrorHandling = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DashboardNotFoundError) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: error.message,
      });
    }

    if (error instanceof DashboardReorderError) {
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
 * tRPC middleware that wraps handler execution to catch and map dashboard domain errors.
 * Usage: procedure.use(dashboardErrorHandler)
 */
export const dashboardErrorHandler = async <T>({
  next,
}: {
  next: () => Promise<T>;
}): Promise<T> => {
  return await withDashboardErrorHandling(next);
};


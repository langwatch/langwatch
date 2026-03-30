import type { TRPCClientErrorLike } from "@trpc/client";
import { isNotFound } from "../../utils/trpcError";

/**
 * Derives a user-facing error message for trace loading failures.
 *
 * - 404/NOT_FOUND errors produce "Trace not found [<traceId>]"
 * - All other errors produce "Couldn't load trace [<traceId>]"
 */
export function getTraceErrorMessage({
  error,
  traceId,
}: {
  error: TRPCClientErrorLike<any> | null;
  traceId: string;
}): string {
  const prefix = isNotFound(error) ? "Trace not found" : "Couldn't load trace";
  return `${prefix} [${traceId}]`;
}

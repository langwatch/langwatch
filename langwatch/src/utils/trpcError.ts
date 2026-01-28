import { TRPCClientError, type TRPCClientErrorLike } from "@trpc/client";
import type { LimitType } from "../server/license-enforcement";

export const isNotFound = (error: TRPCClientErrorLike<any> | null) => {
  if (
    error &&
    error instanceof TRPCClientError &&
    error.data?.httpStatus === 404
  ) {
    return true;
  }
  return false;
};

export interface LimitExceededInfo {
  limitType: LimitType;
  current: number;
  max: number;
}

/**
 * Extracts limit exceeded info from a TRPC error.
 * Returns the info if the error is a FORBIDDEN error with limit data, null otherwise.
 */
export function extractLimitExceededInfo(
  error: unknown,
): LimitExceededInfo | null {
  if (!(error instanceof TRPCClientError)) return null;
  if (error.data?.code !== "FORBIDDEN") return null;

  const cause = error.data?.cause as
    | { limitType?: string; current?: number; max?: number }
    | undefined;

  if (!cause?.limitType) return null;

  return {
    limitType: cause.limitType as LimitType,
    current: typeof cause.current === "number" ? cause.current : 0,
    max: typeof cause.max === "number" ? cause.max : 0,
  };
}

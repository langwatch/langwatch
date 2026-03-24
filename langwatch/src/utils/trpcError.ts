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

// Track handled errors without mutating them
const handledLicenseErrors = new WeakSet<Error>();

/**
 * Mark an error as handled by the global license handler.
 * Called internally by the MutationCache onError handler.
 */
export function markAsHandledByLicenseHandler(error: Error): void {
  handledLicenseErrors.add(error);
}

/**
 * Check if an error was already handled by the global license limit handler.
 * Use this in component-level onError callbacks to avoid showing duplicate
 * error messages (toast + modal) for license limit errors.
 *
 * @example
 * ```tsx
 * const mutation = api.prompts.create.useMutation({
 *   onError: (error) => {
 *     if (isHandledByGlobalLicenseHandler(error)) return;
 *     toaster.create({ title: "Error", description: error.message });
 *   },
 * });
 * ```
 */
export function isHandledByGlobalLicenseHandler(error: unknown): boolean {
  return error instanceof Error && handledLicenseErrors.has(error);
}

export interface LimitExceededInfo {
  limitType: LimitType;
  current: number;
  max: number;
}

/**
 * Extracts limit exceeded info from a TRPC error.
 * Returns the info if the error is a FORBIDDEN error with limit data, null otherwise.
 */
// --- Lite member restriction dedup ---
const handledLiteMemberErrors = new WeakSet<Error>();

export function markAsHandledByLiteMemberHandler(error: Error): void {
  handledLiteMemberErrors.add(error);
}

export function isHandledByLiteMemberHandler(error: unknown): boolean {
  return error instanceof Error && handledLiteMemberErrors.has(error);
}

/**
 * Check if an error was already handled by any global error handler
 * (license limit or lite member restriction).
 * Use this single check in component-level onError callbacks to avoid
 * showing duplicate error messages (toast + modal).
 *
 * @example
 * ```tsx
 * const mutation = api.prompts.create.useMutation({
 *   onError: (error) => {
 *     if (isHandledByGlobalHandler(error)) return;
 *     toaster.create({ title: "Error", description: error.message });
 *   },
 * });
 * ```
 */
export function isHandledByGlobalHandler(error: unknown): boolean {
  return (
    isHandledByGlobalLicenseHandler(error) ||
    isHandledByLiteMemberHandler(error)
  );
}

// --- Lite member restriction extractor ---
export interface LiteMemberRestrictionInfo {
  resource?: string;
}

export function extractLiteMemberRestrictionInfo(
  error: unknown,
): LiteMemberRestrictionInfo | null {
  if (!(error instanceof TRPCClientError)) return null;
  if (error.data?.code !== "UNAUTHORIZED") return null;

  const domainError = error.data?.domainError as
    | { kind?: string; meta?: { resource?: string } }
    | undefined;

  if (domainError?.kind !== "lite_member_restricted") return null;

  return { resource: domainError.meta?.resource };
}

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

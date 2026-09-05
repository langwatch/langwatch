import { TRPCClientError } from "@trpc/client";
import { markHandledGlobally } from "@langwatch/ui-host/errors";

/**
 * The seat levers a licence caps, written out here rather than imported from
 * `@langwatch/enterprise-licensing-contract`: this package is core and may not
 * depend on enterprise. `limitTypes` in that contract is the source of truth.
 */
type LimitType = "members" | "membersLite";

// Track handled errors without mutating them
const handledLicenseErrors = new WeakSet<Error>();

/**
 * Mark an error as handled by the global license handler.
 * Called internally by the MutationCache onError handler.
 */
export function markAsHandledByLicenseHandler(error: Error): void {
  handledLicenseErrors.add(error);
  markHandledGlobally(error);
}

/**
 * Check if an error was already handled by the global license limit handler. Use this
 * in component-level onError callbacks to avoid showing duplicate error messages (toast
 * + modal) for license limit errors.
 */
export function isHandledByGlobalLicenseHandler(error: unknown): boolean {
  return error instanceof Error && handledLicenseErrors.has(error);
}

export interface LimitExceededInfo {
  limitType: LimitType;
  current: number;
  max: number;
}

// --- Lite member restriction dedup ---
const handledLiteMemberErrors = new WeakSet<Error>();

export function markAsHandledByLiteMemberHandler(error: Error): void {
  handledLiteMemberErrors.add(error);
  markHandledGlobally(error);
}

export function isHandledByLiteMemberHandler(error: unknown): boolean {
  return error instanceof Error && handledLiteMemberErrors.has(error);
}

// --- Lite member restriction extractor ---
export interface LiteMemberRestrictionInfo {
  resource?: string;
}

export function extractLiteMemberRestrictionInfo(error: unknown): LiteMemberRestrictionInfo | null {
  if (!(error instanceof TRPCClientError)) return null;
  if (error.data?.code !== "UNAUTHORIZED") return null;

  const handledError = error.data?.error as
    | { code?: string; kind?: string; meta?: { resource?: string } }
    | undefined;

  // `kind` is the deprecated pre-`HandledError` discriminant, read as a
  // fallback so this resolves across the transition (see SerializedHandledError).
  const handledCode = handledError?.code ?? handledError?.kind;
  if (handledCode !== "lite_member_restricted") return null;

  return { resource: handledError?.meta?.resource };
}

/**
 * Extracts limit exceeded info from a TRPC error.
 * Returns the info if the error is a FORBIDDEN error with limit data, null otherwise.
 */
export function extractLimitExceededInfo(error: unknown): LimitExceededInfo | null {
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

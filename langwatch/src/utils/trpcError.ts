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

// --- Missing-model (ModelNotConfiguredError) dedup ---
const handledMissingModelErrors = new WeakSet<Error>();

export function markAsHandledByMissingModelHandler(error: Error): void {
  handledMissingModelErrors.add(error);
}

export function isHandledByMissingModelHandler(error: unknown): boolean {
  return error instanceof Error && handledMissingModelErrors.has(error);
}

export interface MissingModelExtracted {
  featureKey: string;
  featureDisplayName: string;
  role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  projectId?: string;
}

/**
 * Extracts the typed payload from a tRPC error whose cause is
 * `MODEL_NOT_CONFIGURED`. The wire shape is set by the server-side
 * `ModelNotConfiguredError` (see
 * `specs/model-providers/model-resolver-and-registry.feature`).
 */
export function extractMissingModelInfo(
  error: unknown,
): MissingModelExtracted | null {
  if (!(error instanceof TRPCClientError)) return null;
  // Server wraps the typed error as a BAD_REQUEST TRPCError with
  // cause.code === "MODEL_NOT_CONFIGURED". The interceptor keys off the
  // cause string, not the HTTP/TRPC code, so REST and tRPC surfaces both
  // funnel into the same modal.
  const cause = error.data?.cause as
    | {
        code?: string;
        featureKey?: string;
        featureDisplayName?: string;
        role?: string;
        projectId?: string;
      }
    | undefined;

  if (cause?.code !== "MODEL_NOT_CONFIGURED") return null;
  if (!cause.featureKey || !cause.role) return null;

  const role = cause.role as MissingModelExtracted["role"];
  if (role !== "DEFAULT" && role !== "FAST" && role !== "EMBEDDINGS") {
    return null;
  }

  return {
    featureKey: cause.featureKey,
    featureDisplayName: cause.featureDisplayName ?? cause.featureKey,
    role,
    projectId: cause.projectId,
  };
}

// --- Provider-disabled (ModelProviderDisabledError) dedup ---
const handledProviderDisabledErrors = new WeakSet<Error>();

export function markAsHandledByProviderDisabledHandler(error: Error): void {
  handledProviderDisabledErrors.add(error);
}

export function isHandledByProviderDisabledHandler(error: unknown): boolean {
  return error instanceof Error && handledProviderDisabledErrors.has(error);
}

export interface ProviderDisabledExtracted {
  featureKey: string;
  featureDisplayName: string;
  role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  projectId: string;
  resolvedScope: "project" | "team" | "organization";
  resolvedModel: string;
  providerKey: string;
  alternate: {
    scope: "team" | "organization";
    model: string;
    providerKey: string;
    providerEnabled: boolean;
  } | null;
}

/**
 * Extracts the typed payload from a tRPC error whose cause is
 * `MODEL_PROVIDER_DISABLED`. The wire shape is set by the server-side
 * `ModelProviderDisabledError`. The cascade still resolved a model,
 * but that model's provider is currently disabled — so the toast can
 * offer a one-click swap to the next cascade candidate (if any).
 */
export function extractProviderDisabledInfo(
  error: unknown,
): ProviderDisabledExtracted | null {
  if (!(error instanceof TRPCClientError)) return null;
  const cause = error.data?.cause as
    | {
        code?: string;
        featureKey?: string;
        featureDisplayName?: string;
        role?: string;
        projectId?: string;
        resolvedScope?: string;
        resolvedModel?: string;
        providerKey?: string;
        alternate?: ProviderDisabledExtracted["alternate"];
      }
    | undefined;

  if (cause?.code !== "MODEL_PROVIDER_DISABLED") return null;
  if (
    !cause.featureKey ||
    !cause.role ||
    !cause.projectId ||
    !cause.resolvedScope ||
    !cause.resolvedModel ||
    !cause.providerKey
  ) {
    return null;
  }

  const role = cause.role as ProviderDisabledExtracted["role"];
  if (role !== "DEFAULT" && role !== "FAST" && role !== "EMBEDDINGS") {
    return null;
  }
  const resolvedScope =
    cause.resolvedScope as ProviderDisabledExtracted["resolvedScope"];
  if (
    resolvedScope !== "project" &&
    resolvedScope !== "team" &&
    resolvedScope !== "organization"
  ) {
    return null;
  }

  return {
    featureKey: cause.featureKey,
    featureDisplayName: cause.featureDisplayName ?? cause.featureKey,
    role,
    projectId: cause.projectId,
    resolvedScope,
    resolvedModel: cause.resolvedModel,
    providerKey: cause.providerKey,
    alternate: cause.alternate ?? null,
  };
}

/**
 * Wire-side discriminator a server route attaches when a downstream
 * AI call fails for a non-MODEL_NOT_CONFIGURED reason (provider 5xx,
 * 401 on a stale key, malformed custom model id, etc). The frontend
 * lifts it into a softer toast that nudges the user to double-check
 * their model provider configuration — most of these failures trace
 * back to a misset key or wrong model id at the provider layer, and
 * surfacing that hint up front saves a debug round-trip.
 */
export const AI_CALL_FAILED_CAUSE = "AI_CALL_FAILED" as const;

export interface AiCallFailedExtracted {
  featureKey: string;
  featureDisplayName: string;
  role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  /** Best-effort short message from the provider/SDK. */
  errorMessage?: string;
}

export function extractAiCallFailedInfo(
  error: unknown,
): AiCallFailedExtracted | null {
  if (!(error instanceof TRPCClientError)) return null;
  const cause = error.data?.cause as
    | {
        code?: string;
        featureKey?: string;
        featureDisplayName?: string;
        role?: string;
        errorMessage?: string;
      }
    | undefined;

  if (cause?.code !== AI_CALL_FAILED_CAUSE) return null;
  if (!cause.featureKey || !cause.role) return null;
  const role = cause.role as AiCallFailedExtracted["role"];
  if (role !== "DEFAULT" && role !== "FAST" && role !== "EMBEDDINGS") {
    return null;
  }

  return {
    featureKey: cause.featureKey,
    featureDisplayName: cause.featureDisplayName ?? cause.featureKey,
    role,
    errorMessage: cause.errorMessage,
  };
}

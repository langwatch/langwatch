/**
 * Reading a licence refusal off a failed call. Both shapes travel on the
 * serialised `data.cause` and `data.error` sidecars, read structurally rather
 * than through the transport's own class, so REST and tRPC funnel into one modal.
 */

import { markHandledGlobally } from "@langwatch/ui-host/errors";
import type { LimitType } from "@langwatch/enterprise-licensing-contract";

/** As much of a failed call's serialised payload as the readers below name. */
type SerializedFailure = {
  code?: string;
  cause?: { limitType?: string; current?: number; max?: number };
  error?: { code?: string; kind?: string; meta?: { resource?: string } };
};

function failureOf(error: unknown): SerializedFailure | undefined {
  if (!(error instanceof Error)) return undefined;
  const data = (error as { data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as SerializedFailure) : undefined;
}

// --- Seat/resource limit (LimitExceededError) dedup ---
const handledLicenseErrors = new WeakSet<Error>();

/** Marks a limit refusal as answered, so a screen's own `onError` stays quiet. */
export function markAsHandledByLicenseHandler(error: Error): void {
  handledLicenseErrors.add(error);
  markHandledGlobally(error);
}

export function isHandledByGlobalLicenseHandler(error: unknown): boolean {
  return error instanceof Error && handledLicenseErrors.has(error);
}

export interface LimitExceededInfo {
  limitType: LimitType;
  current: number;
  max: number;
}

/**
 * The payload of a limit refusal, whose wire shape the server's
 * `LimitExceededError` sets. A FORBIDDEN without limit data is somebody else's.
 */
export function extractLimitExceededInfo(error: unknown): LimitExceededInfo | null {
  const failure = failureOf(error);
  if (failure?.code !== "FORBIDDEN") return null;

  const cause = failure.cause;
  if (!cause?.limitType) return null;

  return {
    limitType: cause.limitType as LimitType,
    current: typeof cause.current === "number" ? cause.current : 0,
    max: typeof cause.max === "number" ? cause.max : 0,
  };
}

// --- Lite member restriction dedup ---
const handledLiteMemberErrors = new WeakSet<Error>();

/** Marks a lite-member refusal as answered, same contract as the limit one. */
export function markAsHandledByLiteMemberHandler(error: Error): void {
  handledLiteMemberErrors.add(error);
  markHandledGlobally(error);
}

export function isHandledByLiteMemberHandler(error: unknown): boolean {
  return error instanceof Error && handledLiteMemberErrors.has(error);
}

export interface LiteMemberRestrictionInfo {
  resource?: string;
}

/** The payload of the authz `lite_member_restricted` refusal. */
export function extractLiteMemberRestrictionInfo(error: unknown): LiteMemberRestrictionInfo | null {
  const failure = failureOf(error);
  if (failure?.code !== "UNAUTHORIZED") return null;

  const handledError = failure.error;

  // `kind` is the deprecated pre-`HandledError` discriminant, read as a
  // fallback so this resolves across the transition (see SerializedHandledError).
  const handledCode = handledError?.code ?? handledError?.kind;
  if (handledCode !== "lite_member_restricted") return null;

  return { resource: handledError?.meta?.resource };
}

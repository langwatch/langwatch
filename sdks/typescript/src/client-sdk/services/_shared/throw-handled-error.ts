/**
 * The one place the SDK decides "did the platform NAME this failure?",
 * slotted before each service's own throw: a domain-error body raises the
 * typed error; anything else keeps the generic path's behaviour byte for byte.
 */
import { handledErrorFrom, type LangWatchHandledError } from "@/internal/api/errors";

import { extractStatusFromResponse } from "./format-api-error";

export interface ThrowIfHandledErrorParams {
  /** What was being attempted, e.g. `get trace "abc"`. */
  operation: string;
  /** The error body the HTTP client handed back. */
  error: unknown;
  /** The response it came on, when the service kept hold of it. */
  response?: Response;
  /** The status, when the service resolved it already. */
  status?: number;
  /** The sentence the generic path built — reused verbatim so nothing regresses. */
  message: string;
}

/**
 * Throws a {@link LangWatchHandledError} when the platform named the failure.
 * Returns — deliberately, so the caller throws its own error — when it did not.
 */
export function throwIfHandledError({
  operation,
  error,
  response,
  status,
  message,
}: ThrowIfHandledErrorParams): void {
  const resolved = status ?? response?.status ?? extractStatusFromResponse(error);

  const handledError: LangWatchHandledError | null = handledErrorFrom({
    operation,
    body: error,
    status: resolved,
    message,
  });

  if (handledError) throw handledError;
}

/**
 * The one place the SDK decides "did the platform NAME this failure?".
 *
 * Every `*-api.service.ts` funnels its non-2xx responses through a private
 * `handleApiError`, which builds an English sentence and throws that service's
 * own error class. This slots in immediately before the throw: if the body is a
 * domain error, it raises the typed one instead; if it is anything else, it
 * returns and the service throws exactly what it always threw.
 *
 * That ordering is the whole design. Domain errors become typed; everything else
 * — a 5xx, a proxy's HTML, a truncated body, a dead socket — keeps its existing
 * behaviour byte for byte, including the message, because the sentence the
 * generic path already built is handed in and reused rather than rebuilt.
 */
import {
  handledErrorFrom,
  type LangWatchHandledError,
} from "@/internal/api/errors";
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
  const resolved =
    status ?? response?.status ?? extractStatusFromResponse(error);

  const handledError: LangWatchHandledError | null = handledErrorFrom({
    operation,
    body: error,
    status: resolved,
    message,
  });

  if (handledError) throw handledError;
}

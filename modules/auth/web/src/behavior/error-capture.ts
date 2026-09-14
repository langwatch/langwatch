/**
 * Error reporting via PostHog client when present; never sends auth data, only mutation failures
 */

type ErrorCaptureProperties = {
  tags?: Record<string, string>;
};

type PosthogLike = {
  captureException?: (error: Error, properties?: Record<string, unknown>) => void;
};

function client(): PosthogLike | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as { posthog?: PosthogLike }).posthog;
  return candidate && typeof candidate.captureException === "function" ? candidate : null;
}

/** Anything that was thrown, as an Error. */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  return new Error(typeof thrown === "string" ? thrown : JSON.stringify(thrown));
}

/** Reports a failure for observability. Never throws, never blocks. */
export function captureException(error: Error, properties: ErrorCaptureProperties = {}): void {
  try {
    client()?.captureException?.(error, { ...properties.tags });
  } catch {
    // Observability must never be able to take a screen down with it.
  }
}

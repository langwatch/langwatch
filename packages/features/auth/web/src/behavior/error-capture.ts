/**
 * Reporting a failure nobody is going to read on screen.
 *
 * `platform/app/src/utils/posthogErrorCapture.ts` is 276 lines of analytics
 * wiring — the PostHog client, its consent gate and its queue — and a feature
 * web package may hold none of it. What travelled is the two-function shape
 * the invitation hook calls, over the global the application already installs
 * when it has consent. With no client on the page this is a no-op, which is
 * the correct behaviour for a browser that refused analytics.
 *
 * NOTHING FROM AN AUTHENTICATION ATTEMPT IS REPORTED HERE. The one caller is
 * the invitation acceptance hook, and what it sends is the failure of a
 * mutation — never an identifier, a password, a token or a session.
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
export function captureException(
  error: Error,
  properties: ErrorCaptureProperties = {},
): void {
  try {
    client()?.captureException?.(error, { ...properties.tags });
  } catch {
    // Observability must never be able to take a screen down with it.
  }
}

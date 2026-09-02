/**
 * An unknown thrown value, as an `Error`.
 *
 * `platform/app` keeps this next to its PostHog capture helper; the studio's
 * closure uses only the coercion, never the capture, so only the coercion
 * travelled. Product analytics is the application's and has no capability here
 * — the same refusal the workflows list recorded for `trackEvent`.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

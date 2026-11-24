/**
 * Masks what a crash's text may carry before it leaves the browser: a widget's error can quote
 * a token, an email or a payload. Pure and browser-safe; the server's redactors are pino-bound.
 */

const MESSAGE_LIMIT = 500;
// A stack is many frames long; the cap only stops a runaway one.
const STACK_LIMIT = 4_000;
const TRUNCATED = " [truncated]";

const MASKS: readonly (readonly [RegExp, string])[] = [
  [
    /\b(api[-_]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
    "$1$2[redacted]",
  ],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted]"],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[0-9a-f]{32,}\b/gi, "[redacted]"],
  // Long base64 runs that hold a digit; no "/" so a stack frame's URL path survives.
  [/(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{40,}={0,2}/g, "[redacted]"],
];

/** The text with tokens, emails and long encoded runs masked, then cut to `limit`. */
export function redactCrashText({ text, limit }: { text: string; limit: number }): string {
  const masked = MASKS.reduce((current, [pattern, mask]) => current.replace(pattern, mask), text);
  return masked.length > limit ? masked.slice(0, limit) + TRUNCATED : masked;
}

/** A copy of the crash, message and stack redacted; a string becomes an Error with no stack. */
export function redactCrashError(error: Error | string): Error {
  const source = error instanceof Error ? error : undefined;
  const text = typeof error === "string" ? error : error.message;
  const redacted = new Error(redactCrashText({ text, limit: MESSAGE_LIMIT }));
  redacted.name = source?.name ?? "Error";
  // Not our own frames: a stack from here would point PostHog at this file.
  redacted.stack = source?.stack
    ? redactCrashText({ text: source.stack, limit: STACK_LIMIT })
    : undefined;
  return redacted;
}

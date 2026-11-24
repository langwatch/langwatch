import { redactSecretsInText, SECRETS_REDACTION_MARKER } from "@langwatch/redaction/secrets";

/**
 * Masks what a crash's text may carry before it leaves the browser: a widget's error can quote
 * a token, an email or a payload. Credentials go through the shared secrets redactor; the masks
 * here are the crash-only extras. Pure and browser-safe.
 */

const MESSAGE_LIMIT = 500;
// A stack is many frames long; the cap only stops a runaway one.
const STACK_LIMIT = 4_000;
const TRUNCATED = " [truncated]";

// Crash-only extras: the shared redactor needs a vendor prefix or a credential keyword.
const MASKS: readonly (readonly [RegExp, string])[] = [
  // The shared redactor needs 16+ characters; a crash report leaving the browser must not carry
  // a short assigned value either.
  [
    /\b(api[-_]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
    `$1$2${SECRETS_REDACTION_MARKER}`,
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[0-9a-f]{32,}\b/gi, SECRETS_REDACTION_MARKER],
  // Long base64 runs that hold a digit; no "/" so a stack frame's URL path survives.
  [/(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{40,}={0,2}/g, SECRETS_REDACTION_MARKER],
];

// The base64 mask is quadratic on long digit-free text, so masking only sees a bounded prefix.
// The margin keeps a token that straddles the limit whole enough to be masked.
const PRE_CUT_MARGIN = 256;

/** The text with tokens, emails and long encoded runs masked, then cut to `limit`. */
export function redactCrashText({ text, limit }: { text: string; limit: number }): string {
  const bounded = text.slice(0, limit + PRE_CUT_MARGIN);
  const wasCut = bounded.length < text.length;
  const masked = MASKS.reduce(
    (current, [pattern, mask]) => current.replace(pattern, mask),
    redactSecretsInText({ text: bounded }).text,
  );
  return wasCut || masked.length > limit ? masked.slice(0, limit) + TRUNCATED : masked;
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

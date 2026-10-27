/**
 * Browser errors as spans: `console.error`, `window.onerror` and unhandled rejections reach
 * the same session-stamped export as every other browser span (ADR-058). Only the error name,
 * file:line frames and a scrubbed, capped message leave the tab; objects are named by type.
 */

import { nowInstant } from "@langwatch/time";
import { SpanStatusCode, trace } from "@opentelemetry/api";

import { RUM_INSTRUMENTATION_NAME } from "./constants.ts";

export const ATTR_BROWSER_ERROR_SOURCE = "langwatch.browser_error.source";
export const BROWSER_ERROR_MAX_LENGTH = 500;
export const BROWSER_ERROR_MAX_FRAMES = 10;
export const BROWSER_ERROR_WINDOW_MS = 60_000;
export const BROWSER_ERROR_MAX_PER_WINDOW = 20;

export type BrowserErrorSource = "console" | "window" | "unhandledrejection";

const URL_PATTERN = /(https?:\/\/[^\s?#"'<>)]+|\/[^\s?#"'<>)]+)[?#][^\s"'<>)]*/g;
const SHARE_PATH_PATTERN = /\/share\/[^/\s?#"'<>)]+/g;
const USERINFO_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@"'<>]+@/gi;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g;
const PREFIXED_TOKEN_PATTERN = /\b(?:sk|pat)[-_][\w-]{4,}/gi;
const SECRET_PAIR_PATTERN =
  /(["']?[\w-]*(?:token|secret|password|passwd|authorization|auth|key|cookie)[\w-]*["']?)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;
const LONG_RUN_PATTERN = /[A-Za-z0-9_+/-]{20,}={0,2}/g;
const FRAME_PATTERN = /([^\s()@]+?)(?:\?[^\s:]*)?:(\d+)(?::\d+)?\)?\s*$/;
/** A V8 `at ...` frame or a Firefox/Safari `fn@url` frame; `Name: message` lines are neither. */
const FRAME_LINE_PATTERN = /^\s*at\s|^[^\s@]*@/;

/** Drops the query string and fragment from every URL in a value. */
export function stripUrlQueries({ value }: { value: string }): string {
  return value.replace(URL_PATTERN, "$1");
}

/** A share link's path segment is its access; every value names the route `/share/:id` instead. */
export function redactSharePaths({ value }: { value: string }): string {
  return value.replace(SHARE_PATH_PATTERN, "/share/:id");
}

/** Redacts anything credential- or person-shaped, drops query strings, and caps the length. */
export function sanitiseErrorMessage({ message }: { message: string }): string {
  return redactSharePaths({ value: stripUrlQueries({ value: message }) })
    .replace(USERINFO_PATTERN, "$1")
    .replace(EMAIL_PATTERN, "[email]")
    .replace(BEARER_PATTERN, "$1 [redacted]")
    .replace(JWT_PATTERN, "[redacted]")
    .replace(PREFIXED_TOKEN_PATTERN, "[redacted]")
    .replace(SECRET_PAIR_PATTERN, "$1=[redacted]")
    .replace(LONG_RUN_PATTERN, "[redacted]")
    .slice(0, BROWSER_ERROR_MAX_LENGTH);
}

/** Keeps only `file:line` per frame (no function names, hosts, queries or columns). */
export function sanitiseStack({ stack }: { stack: string | undefined }): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .filter((line) => FRAME_LINE_PATTERN.test(line))
    .map((line) => FRAME_PATTERN.exec(line)?.slice(1, 3))
    .filter((match): match is [string, string] => match?.length === 2)
    .slice(0, BROWSER_ERROR_MAX_FRAMES)
    .map(([file, line]) => `${file.split("/").pop() ?? file}:${line}`)
    .join("\n");
}

/** Strings and Errors carry their message; any other value is named by type, never printed. */
export function describeErrorValue({ value }: { value: unknown }): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return `[${value === null ? "null" : typeof value}]`;
}

/** Admits a message once per window and no more than a fixed number per window overall. */
export function createErrorGate({ now = () => nowInstant().epochMilliseconds } = {}) {
  const lastSent = new Map<string, number>();
  let windowStart = 0;
  let sentInWindow = 0;
  return {
    admit({ message }: { message: string }): boolean {
      const at = now();
      if (at - windowStart >= BROWSER_ERROR_WINDOW_MS) {
        windowStart = at;
        sentInWindow = 0;
        lastSent.clear();
      }
      if (lastSent.has(message) || sentInWindow >= BROWSER_ERROR_MAX_PER_WINDOW) return false;
      lastSent.set(message, at);
      sentInWindow += 1;
      return true;
    },
  };
}

function recordBrowserError({
  source,
  message,
  stack,
}: {
  source: BrowserErrorSource;
  message: string;
  stack: string;
}): void {
  const span = trace.getTracer(RUM_INSTRUMENTATION_NAME).startSpan("browser.error", {
    attributes: {
      [ATTR_BROWSER_ERROR_SOURCE]: source,
      "exception.message": message,
      ...(stack ? { "exception.stacktrace": stack } : {}),
    },
  });
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.end();
}

let installed = false;

/** Wraps `console.error` once (the original still runs) and listens for page-level errors. */
export function startBrowserErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const gate = createErrorGate();
  let reporting = false;
  const report = ({
    source,
    raw,
    error,
  }: {
    source: BrowserErrorSource;
    raw: string;
    error?: unknown;
  }) => {
    if (reporting) return;
    reporting = true;
    try {
      const message = sanitiseErrorMessage({ message: raw });
      const stack = sanitiseStack({ stack: error instanceof Error ? error.stack : undefined });
      if (message.trim() && gate.admit({ message })) recordBrowserError({ source, message, stack });
    } catch {
      // Telemetry never breaks the page it measures.
    } finally {
      reporting = false;
    }
  };

  const original = console.error;
  console.error = (...args: unknown[]) => {
    original.apply(console, args);
    report({
      source: "console",
      raw: args.map((value) => describeErrorValue({ value })).join(" "),
      error: args.find((value) => value instanceof Error),
    });
  };
  window.addEventListener("error", (event) =>
    report({
      source: "window",
      raw: describeErrorValue({ value: event.error ?? event.message }),
      error: event.error,
    }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    report({
      source: "unhandledrejection",
      raw: describeErrorValue({ value: event.reason }),
      error: event.reason,
    }),
  );
}

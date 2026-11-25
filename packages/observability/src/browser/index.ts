/**
 * Browser-legal public API for `@langwatch/observability/browser` — the
 * one entry web code should use for a logger. Never evaluates
 * `node:async_hooks`, `node:process` or `@opentelemetry/*`; pinned by `runtimeSafety.unit.test.ts`.
 */
export {
  createLogger,
  type BrowserLogger,
  type BrowserLogLevel,
  type CreateBrowserLoggerOptions,
} from "./logger.ts";

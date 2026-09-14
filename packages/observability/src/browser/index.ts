/**
 * Browser-legal public API for `@langwatch/observability/browser`.
 *
 * The one export map entry web code should reach for a logger: it never
 * evaluates `node:async_hooks`, `node:process` or `@opentelemetry/*`, because
 * nothing in its own graph imports them. See `runtimeSafety.unit.test.ts`,
 * which pins that graph shape.
 */
export {
  createLogger,
  type BrowserLogger,
  type BrowserLogLevel,
  type CreateBrowserLoggerOptions,
} from "./logger.ts";

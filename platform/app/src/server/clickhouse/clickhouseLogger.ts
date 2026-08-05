import type {
  ErrorLogParams,
  Logger,
  LogParams,
  WarnLogParams,
} from "@clickhouse/client";
import { emitVendorLog } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:clickhouse");

/**
 * Routes @clickhouse/client's internal logs through our pino logger so they
 * share the same console format as the rest of the app (and the Go services)
 * instead of the client's own `[ts][ERROR][@clickhouse/client][module]` lines.
 *
 * What reaches the log, and what is dropped, is decided by
 * `@langwatch/clickhouse-client` so every ClickHouse construction site in the
 * repo answers to the same policy. The short version: the vendor's `error` is
 * dropped, because the client cannot know whether the caller retried and
 * succeeded, and no cause is ever attached under a field named `error`,
 * because that is what Loki reads to decide a record's level.
 *
 * The client instantiates this with `new ()` (see its `log.LoggerClass`
 * option), so it must have a zero-arg constructor — it borrows the module
 * singleton above. The client gates which levels reach us via `log.level`
 * (defaults to WARN), so `trace`/`debug`/`info` rarely fire in practice.
 */
export class ClickHouseLogger implements Logger {
  trace(params: LogParams): void {
    emitVendorLog(logger, "trace", params);
  }

  debug(params: LogParams): void {
    emitVendorLog(logger, "debug", params);
  }

  info(params: LogParams): void {
    emitVendorLog(logger, "info", params);
  }

  warn(params: WarnLogParams): void {
    emitVendorLog(logger, "warn", params);
  }

  error(params: ErrorLogParams): void {
    emitVendorLog(logger, "error", params);
  }
}

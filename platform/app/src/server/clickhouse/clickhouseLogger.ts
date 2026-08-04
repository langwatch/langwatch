import type {
  ErrorLogParams,
  Logger,
  LogParams,
  WarnLogParams,
} from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:clickhouse");

/**
 * Routes @clickhouse/client's internal logs through our pino logger so they
 * share the same console format as the rest of the app (and the Go services)
 * instead of the client's own `[ts][ERROR][@clickhouse/client][module]` lines.
 *
 * The client instantiates this with `new ()` (see its `log.LoggerClass`
 * option), so it must have a zero-arg constructor — it borrows the module
 * singleton above. The client gates which levels reach us via `log.level`
 * (defaults to WARN), so `trace`/`debug`/`info` rarely fire in practice.
 */
export class ClickHouseLogger implements Logger {
  trace({ module, message, args }: LogParams): void {
    logger.debug({ module, ...args }, message);
  }

  debug({ module, message, args }: LogParams): void {
    logger.debug({ module, ...args }, message);
  }

  info({ module, message, args }: LogParams): void {
    logger.info({ module, ...args }, message);
  }

  warn({ module, message, args, err }: WarnLogParams): void {
    logger.warn({ module, ...args, error: err }, message);
  }

  error({ module, message, args, err }: ErrorLogParams): void {
    logger.error({ module, ...args, error: err }, message);
  }
}

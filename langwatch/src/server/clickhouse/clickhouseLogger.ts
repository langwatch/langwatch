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

  /**
   * Deliberately logged at WARN, not error.
   *
   * The client calls this from `logRequestError` for EVERY failed HTTP attempt,
   * before anything decides whether the attempt is fatal. Our resilient client
   * retries transient failures and only most of them ever reach a caller, so at
   * error level this reports a recovered retry as an error — in prod it was the
   * single largest source of ERROR-severity lines while the underlying query
   * failure rate was a rounding error, and Loki's own level detection reads the
   * word in the message and tags the line `error` regardless of severity.
   *
   * Nothing is lost by downgrading: a query that fails after its retries are
   * exhausted is logged at error by `logFailure` in the resilient client, with
   * the operation, duration and query id attached. That line is the one that
   * means a caller saw a failure; this one means an attempt was made again.
   */
  error({ module, message, args, err }: ErrorLogParams): void {
    logger.warn({ module, ...args, error: err }, message);
  }
}

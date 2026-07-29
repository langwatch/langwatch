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
   * Deliberately warn, not error.
   *
   * The driver logs every failed request here ("Query: HTTP request error.")
   * including ones it is about to retry successfully, and every one that our
   * own call sites then catch, wrap with the query/table/tenant context and
   * log again. That made a single ClickHouse hiccup produce at least two
   * ERROR lines — together ~53k/day, roughly 90% of the platform's entire
   * error volume, none of it individually actionable.
   *
   * The authoritative severity call belongs to the caller that knows whether
   * the failure was retried, fell back, or actually broke something. This
   * stays queryable at warn for the transport-level detail (which retry, which
   * socket) that the wrapped error drops.
   */
  error({ module, message, args, err }: ErrorLogParams): void {
    logger.warn({ module, ...args, error: err }, message);
  }
}

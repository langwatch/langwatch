import type { Cluster, Redis } from "ioredis";

/**
 * Standalone and cluster clients differ in capability (cluster has no
 * multi-key transactions across slots, and only database 0), so consumers
 * that care must narrow.
 */
export type RedisConnection = Redis | Cluster;

/**
 * The subset of a structured logger this package uses. Declared structurally so
 * the package stays free of a logging dependency — `createLogger()` from
 * `@langwatch/observability` satisfies it, and so does a test spy.
 */
export interface RedisLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

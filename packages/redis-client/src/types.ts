import type { Cluster, Redis } from "ioredis";

/**
 * The connection type the platform passes around. Standalone and cluster
 * clients differ in capability (cluster has no multi-key transactions across
 * slots, and only database 0), so consumers that care must narrow; everything
 * else treats them alike.
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

/**
 * @langwatch/redis-client — Redis as an owned client, never a module singleton
 * (ADR-093).
 *
 * Three services, each constructed by whoever needs it and given its
 * collaborators up front:
 *
 *   RedisConfigService      pure — resolves an environment into a connection
 *                           plan, and answers "is Redis configured at all?"
 *                           without building anything
 *   RedisConnectionService  builds clients; the only place in the platform
 *                           that constructs ioredis
 *   RedisReadinessService   probes a connection the caller hands it
 *
 * The package reads no ambient state and opens no socket on import: the
 * composition root (`platform/app/src/server/app-layer/presets.ts`) builds the
 * one connection and everything else reaches it as `getApp().redis`.
 *
 * The endpoint and database-index parsers are deliberately NOT exported — they
 * are implementation details of `RedisConfigService.resolve`, and the behaviour
 * they carry is covered through it.
 */
export { RedisConfigService } from "./config";
export type {
  RedisClusterConfig,
  RedisClusterEndpoint,
  RedisConfigResolution,
  RedisEnvironment,
  RedisStandaloneConfig,
  RedisTlsSetting,
  RedisUnconfigured,
} from "./config";
export { RedisConnectionService } from "./connection";
export type { RedisConnectionServiceOptions } from "./connection";
export { RedisReadinessService } from "./readiness";
export type { RedisPingOptions, RedisReadinessServiceOptions } from "./readiness";
export { RedisShutdownService } from "./shutdown";
export type { RedisConnection, RedisLogger } from "./types";

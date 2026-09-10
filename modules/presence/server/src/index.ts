export { presenceServer } from "./presence.server.ts";
export { presenceTrpcTransport } from "./transport/presence.trpc.ts";
export type { PresenceInfrastructure } from "./app/presence.app.ts";
export { presenceRepositories } from "./repositories/presence-repositories.registry.ts";
export {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  PresenceEmitterPort,
} from "./ports/presence.port.ts";

/**
 * The tenant broadcast fabric the presence emitter and the export relay both subscribe on.
 */
export { RedisBroadcastRepository as BroadcastAdapter, type BroadcastEventType } from "./repositories/redis/redis.broadcast.repository.ts";
export {
  BroadcastTenantRateLimiterAdapter,
  type BucketConfig,
  type TierConfig,
} from "./adapters/broadcast-tenant-rate-limiter.adapter.ts";

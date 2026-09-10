export { presenceServer } from "./presence.server.ts";
export { presenceTrpcTransport } from "./transport/presence.trpc.ts";
export {
  type PresenceBroadcast,
  type PresenceDiagnostics,
  type PresenceEmitter,
  type PresenceInfrastructure,
} from "./app/presence.app.ts";
export { presenceRepositories } from "./repositories/presence-repositories.registry.ts";

/**
 * The tenant broadcast fabric the presence emitter and the export relay both subscribe on.
 */
export { RedisBroadcastRepository as BroadcastAdapter, type BroadcastEventType } from "./repositories/redis/redis.broadcast.repository.ts";
export {
  BroadcastTenantRateLimiterAdapter,
  type BucketConfig,
  type TierConfig,
} from "./services/broadcast-tenant-rate-limiter.service.ts";

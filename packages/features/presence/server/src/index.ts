export {
  RuntimePresenceAdapter,
  type RuntimePresenceAdapterOptions,
} from "./adapters/runtime-presence.adapter";
export { PresenceTrpcApi, type PresenceTrpcContext } from "./transport/api-trpc/presence.api";
export {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  PresenceEmitterPort,
} from "./ports/presence.port";
export { PresenceStreamService } from "./services/presence-stream.service";

/**
 * The tenant broadcast fabric the presence emitter and the export relay both
 * subscribe on.
 *
 * It lived in the platform application's app-layer, which is why presence — the
 * feature that DEFINES both broadcast ports — could not compose itself: the
 * publisher and the per-tenant emitter were somewhere neither this package nor
 * any process outside that application could reach. It moved whole; the Redis
 * fan-out, the per-tenant rate limiter and the emitter reaping are unchanged.
 */
export { BroadcastService, type BroadcastEventType } from "./adapters/broadcast.adapter";
export { BroadcasterNotActiveError } from "./adapters/broadcast.errors";
export {
  TenantRateLimiter,
  type BucketConfig,
  type TierConfig,
} from "./adapters/broadcast-tenant-rate-limiter";

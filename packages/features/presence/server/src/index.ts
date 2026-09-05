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
 * The tenant broadcast fabric the presence emitter and the export relay both subscribe on.
 */
export { BroadcastAdapter, type BroadcastEventType } from "./adapters/broadcast.adapter";
export {
  BroadcastTenantRateLimiterAdapter,
  type BucketConfig,
  type TierConfig,
} from "./adapters/broadcast-tenant-rate-limiter.adapter";

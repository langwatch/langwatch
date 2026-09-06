export {
  RuntimePresenceAdapter,
  type RuntimePresenceAdapterOptions,
} from "./adapters/runtime-presence.adapter.ts";
export { PresenceTrpcApi, type PresenceTrpcContext } from "./transport/api-trpc/presence.api.ts";
export {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  PresenceEmitterPort,
} from "./ports/presence.port.ts";
export { PresenceStreamService } from "./services/presence-stream.service.ts";

/**
 * The tenant broadcast fabric the presence emitter and the export relay both subscribe on.
 */
export { BroadcastAdapter, type BroadcastEventType } from "./adapters/broadcast.adapter.ts";
export {
  BroadcastTenantRateLimiterAdapter,
  type BucketConfig,
  type TierConfig,
} from "./adapters/broadcast-tenant-rate-limiter.adapter.ts";

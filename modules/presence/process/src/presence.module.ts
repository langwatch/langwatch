import { defineProcessModule } from "@langwatch/process";
import type { Cluster, Redis } from "ioredis";

import {
  PresenceModule,
  type PresenceBroadcast,
  type PresenceEmitter,
} from "./app/presence.app.ts";
import { presenceSettingsEventing } from "./eventing/presence-settings.pipeline.ts";
import { MemoryBroadcastTenantRateLimiterRepository } from "./repositories/memory/memory.broadcast-tenant-rate-limiter.repository.ts";
import { presenceRepositories } from "./repositories/presence-repositories.registry.ts";
import { RedisBroadcastRepository } from "./repositories/redis/redis.broadcast.repository.ts";
import { presenceTrpcTransport } from "./transport/presence.trpc.ts";

export const presenceProcessModule = defineProcessModule("presence")
  .withRepositories(presenceRepositories)
  .withApi(PresenceModule)
  .withTransports(presenceTrpcTransport)
  .withEventing(presenceSettingsEventing);

/** The tenant broadcast fabric a worker composition mounts beside its own app. */
export type PresenceBroadcastCapability = PresenceBroadcast &
  PresenceEmitter &
  Readonly<{ start(): Promise<void>; close(): Promise<void> }>;

/** Composes the tenant broadcast fabric from the process's own Redis. */
export function createBroadcast(redis: Redis | Cluster | null): PresenceBroadcastCapability {
  return RedisBroadcastRepository.create(redis, {
    sender: MemoryBroadcastTenantRateLimiterRepository.create(),
    subscriber: MemoryBroadcastTenantRateLimiterRepository.create(),
  });
}

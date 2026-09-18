import type { Cluster, Redis } from "ioredis";
import { defineServerModule } from "@langwatch/kernel";
import { PresenceApp, type PresenceBroadcast, type PresenceEmitter } from "./app/presence.app.ts";
import { presenceRepositories } from "./repositories/presence-repositories.registry.ts";
import { RedisBroadcastRepository } from "./repositories/redis/redis.broadcast.repository.ts";
import { presenceTrpcTransport } from "./transport/presence.trpc.ts";

export const presenceServer = defineServerModule("presence")
  .withRepositories(presenceRepositories)
  .withApp(PresenceApp)
  .withTransports(presenceTrpcTransport);

/** The tenant broadcast fabric a worker composition mounts beside its own app. */
export type PresenceBroadcastCapability = PresenceBroadcast &
  PresenceEmitter &
  Readonly<{ start(): Promise<void>; close(): Promise<void> }>;

/** Composes the tenant broadcast fabric from the process's own Redis. */
export function createBroadcast(redis: Redis | Cluster | null): PresenceBroadcastCapability {
  return RedisBroadcastRepository.create(redis);
}

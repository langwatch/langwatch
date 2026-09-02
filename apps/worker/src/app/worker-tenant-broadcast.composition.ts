import {
  RedisTenantBroadcastAdapter,
  TenantBroadcastPublisherPort,
  type TenantBroadcastPort,
} from "@langwatch/notification-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

/**
 * The one publisher this process tells a tenant's open tabs through.
 *
 * Three pipelines will want it — a trace summary advancing, a simulation run
 * advancing, a Langy conversation fold advancing — and all three publish the
 * same object onto the same channel. Composing it once here, rather than once
 * per pipeline as each converts, is what keeps the wire format single: the
 * subscriber is in the application and type-checks against none of them.
 *
 * Nothing when the deployment configured no Redis. There is no local fallback
 * to take: the application's `BroadcastService` falls back to emitting to the
 * tabs ITS OWN process is serving, and this process serves none. A composition
 * that returned a publisher regardless would accept every broadcast and deliver
 * none of them, which is the failure this whole capability exists to make
 * visible.
 */
export function tryCreateWorkerTenantBroadcast(options: {
  redis?: RedisConnection | null;
  logger?: Logger;
}): TenantBroadcastPort | undefined {
  if (!options.redis) return undefined;

  return RedisTenantBroadcastAdapter.create({
    publisher: new WorkerTenantBroadcastPublisher(options.redis),
    logger: options.logger ?? createLogger("langwatch:tenant-broadcast"),
  });
}

/** The one Redis operation a broadcast performs. */
class WorkerTenantBroadcastPublisher extends TenantBroadcastPublisherPort {
  constructor(private readonly connection: RedisConnection) {
    super();
  }

  publish(channel: string, message: string): Promise<number> {
    return this.connection.publish(channel, message);
  }
}

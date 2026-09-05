import {
  RedisTenantBroadcastAdapter,
  TenantBroadcastPublisherPort,
  type TenantBroadcastPort,
} from "@langwatch/notification-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

/**
 * The one publisher this process tells a tenant's open tabs through. Three pipelines will want
 * it — a trace summary advancing, a simulation run advancing, a Langy conversation fold
 * advancing — and all three publish the same object onto the same channel.
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

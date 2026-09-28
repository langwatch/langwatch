import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  TraceTenantBroadcast,
  type TraceTenantBroadcastMessage,
} from "../trace-tenant-broadcast.channel.ts";

/** The one Redis operation a publish needs; a `Redis`, a `Cluster` and a double all satisfy it. */
export type TraceTenantBroadcastPublisher = Readonly<{
  publish(channel: string, message: string): Promise<number>;
}>;

const logger = createLogger("langwatch:trace:tenant-broadcast");

/**
 * Publishes onto main's tenant channel (`broadcast:<eventType>`, body `{ tenantId, event,
 * timestamp }`); presence's subscriber in every process relays it to the tenant's open tabs.
 */
export class RedisTraceTenantBroadcastChannel extends TraceTenantBroadcast {
  static create(publisher: TraceTenantBroadcastPublisher): RedisTraceTenantBroadcastChannel {
    return new RedisTraceTenantBroadcastChannel(publisher);
  }

  private constructor(private readonly publisher: TraceTenantBroadcastPublisher) {
    super();
  }

  async broadcastToTenant({
    tenantId,
    event,
    eventType,
  }: TraceTenantBroadcastMessage): Promise<void> {
    const body = JSON.stringify({ tenantId, event, timestamp: nowInstant().epochMilliseconds });
    try {
      await this.publisher.publish(`broadcast:${eventType}`, body);
    } catch (error) {
      logger.error(
        { tenantId, eventType, error: error instanceof Error ? error.message : String(error) },
        "Could not publish a trace update; open tabs refresh on their next refetch",
      );
    }
  }
}

import type { TenantBroadcast } from "@langwatch/notification-server";
import type { Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { type TraceTenantBroadcast } from "@langwatch/trace-server";
import { tryCreateWorkerTenantBroadcast } from "./worker-tenant-broadcast.composition.ts";

/**
 * MOUNTED; publishes traceUpdateBroadcast and spanStorageBroadcast via the
 * shared Redis publisher.
 */
export function tryCreateWorkerTraceBroadcast(options: {
  redis?: RedisConnection | null;
  broadcast?: TenantBroadcast;
  logger?: Logger;
}): TraceTenantBroadcast | undefined {
  const broadcast =
    options.broadcast ??
    tryCreateWorkerTenantBroadcast({ redis: options.redis, logger: options.logger });
  if (!broadcast) return undefined;

  return new WorkerTraceTenantBroadcastAdapter(broadcast);
}

/**
 * Renames the shared publisher; argument shape is the only difference. Event
 * type passes through.
 */
class WorkerTraceTenantBroadcastAdapter implements TraceTenantBroadcast {
  constructor(private readonly broadcast: TenantBroadcast) {}

  broadcastToTenant(tenantId: string, event: string, eventType: "trace_updated"): Promise<void> {
    return this.broadcast.broadcastToTenant({ tenantId, event, eventType });
  }
}

import type { TenantBroadcastPort } from "@langwatch/notification-server";
import type { Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { TraceTenantBroadcastPort } from "@langwatch/trace-server";
import { tryCreateWorkerTenantBroadcast } from "./worker-tenant-broadcast.composition";

/**
 * The realtime half of trace ingestion, as the port Trace declares.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still
 * registers `traceUpdateBroadcast` and `spanStorageBroadcast` — so nothing in
 * this process publishes yet. What has to be true today is that this
 * composition root CAN answer Trace's own broadcast port from the shared
 * publisher that already ships in `@langwatch/notification-server`, which is
 * what the ledger recorded as the second named absence blocking the
 * conversion.
 *
 *     TraceTenantBroadcastPort              (trace-server declares it)
 *       └─ WorkerTraceTenantBroadcastAdapter        a rename, nothing else
 *            └─ RedisTenantBroadcastAdapter         channel + body, pinned
 *                 └─ this process's Redis           one PUBLISH
 *
 * ONE PUBLISHER, THREE PRODUCERS. Trace, Scenario and Langy all advance
 * projections a tenant's tabs are watching, and all three publish the same
 * object onto the same channel. Only Trace declares its port here, because only
 * Trace is converting; Scenario's `simulation_updated` and Langy's
 * `langy_conversation_updated` producers are still the application's and stay
 * that way until those features convert. They will reuse
 * `tryCreateWorkerTenantBroadcast` the same way this does, so the wire format
 * stays single.
 *
 * Nothing when the deployment configured no Redis, for the reason the shared
 * composition already gives: this process serves no tabs, so there is no local
 * fallback to take, and a port that accepted every broadcast and delivered none
 * is the failure the capability exists to make visible.
 */
export function tryCreateWorkerTraceBroadcast(options: {
  redis?: RedisConnection | null;
  broadcast?: TenantBroadcastPort;
  logger?: Logger;
}): TraceTenantBroadcastPort | undefined {
  const broadcast =
    options.broadcast ??
    tryCreateWorkerTenantBroadcast({ redis: options.redis, logger: options.logger });
  if (!broadcast) return undefined;

  return new WorkerTraceTenantBroadcastAdapter(broadcast);
}

/**
 * Renames the shared publisher onto Trace's own port.
 *
 * The argument shape is the only difference between the two: Trace's port keeps
 * the application's positional `broadcastToTenant` so the application satisfies
 * it without an edit, and the shared capability takes a named input. The event
 * type is not re-derived here — it is passed through from the caller, so a
 * subscriber that started publishing something other than `trace_updated` would
 * have to say so at its own call site rather than having it silently corrected.
 */
class WorkerTraceTenantBroadcastAdapter extends TraceTenantBroadcastPort {
  constructor(private readonly broadcast: TenantBroadcastPort) {
    super();
  }

  broadcastToTenant(tenantId: string, event: string, eventType: "trace_updated"): Promise<void> {
    return this.broadcast.broadcastToTenant({ tenantId, event, eventType });
  }
}

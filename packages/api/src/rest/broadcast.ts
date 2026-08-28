/**
 * Fan-out to every browser watching one tenant, as a REST family uses it.
 *
 * Delivery is Redis pub/sub with a local fallback, and which of the two is
 * live depends on the process, so the transport takes the capability rather
 * than the mechanism. Only the two calls a REST handler makes are named here:
 * the plain broadcast, and the rate-limited one a high-frequency delta stream
 * uses so a fast producer cannot swamp the channel.
 *
 * The rate-limited call answers whether the event was published; a family that
 * broadcasts a delta does not act on that, which is why the results are typed
 * as `unknown` rather than pinned.
 */
export interface AppRestBroadcast {
  broadcastToTenant(
    tenantId: string,
    message: string,
    eventType: "simulation_updated" | "export_progress",
  ): Promise<unknown>;

  broadcastToTenantRateLimited(
    tenantId: string,
    message: string,
    eventType: "simulation_updated",
    tier: "structural" | "delta",
  ): Promise<unknown>;
}

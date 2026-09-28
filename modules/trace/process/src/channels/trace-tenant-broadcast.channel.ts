/** One push to a tenant's open tabs; the browser receives `event` verbatim. */
export type TraceTenantBroadcastMessage = Readonly<{
  tenantId: string;
  event: string;
  eventType: "trace_updated" | "discover_updated";
}>;

/** Trace's tenant pushes: `trace_updated` from the worker, `discover_updated` from the api. */
export abstract class TraceTenantBroadcast {
  abstract broadcastToTenant(input: TraceTenantBroadcastMessage): Promise<void>;
}

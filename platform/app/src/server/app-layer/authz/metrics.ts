import { Counter, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
register.removeSingleMetric("authz_engine_gate_read_failures_total");

/**
 * The gate's migration-state read failed (`engine-gate.ts`): for up to the
 * cache TTL, this organization is served by the legacy path regardless of its
 * true migration status, reads and writes alike. The failure already logs a
 * structured warn; this counter is what lets an outage that reopens the
 * window page rather than sit unread in the log stream.
 */
export const authzEngineGateReadFailuresTotal = new Counter({
  name: "authz_engine_gate_read_failures_total",
  help: "Failed reads of an organization's authz migration state; the organization stays on the legacy path for the cache TTL.",
});

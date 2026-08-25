import { Counter, Histogram, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
const metricNames = [
  "identity_write_gate_read_failures_total",
  "identity_projection_convergence_timeouts_total",
  "identity_commit_duration_seconds",
] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

/**
 * The write gate's migration-state read failed (`write-gate.ts`):
 * for up to the negative-cache TTL this user's ceremonies emit no identity
 * events regardless of their true backfill status. Protocol behavior is
 * unaffected — the gap is event history, which the backfill's next pass
 * adopts. The failure already logs a structured warn; the counter is what
 * lets an outage that reopens the window page rather than sit unread.
 */
export const identityWriteGateReadFailuresTotal = new Counter({
  name: "identity_write_gate_read_failures_total",
  help: "Failed reads of a user's identifier-backfill migration state; ceremonies emit no events for the negative-cache TTL.",
});

/**
 * A ceremony's read-your-writes wait expired before the fold landed its
 * events in the `Identifier` projection (the grants ledger's
 * `awaitProjection` shape). The facts are durable either way — this counts
 * the callers that returned before the projection agreed, which is the
 * signal that the fold is lagging.
 */
export const identityProjectionConvergenceTimeoutsTotal = new Counter({
  name: "identity_projection_convergence_timeouts_total",
  help: "Identity ceremonies that returned before the fold landed their events; the append is durable and the projection converges later.",
});

/** End-to-end cost of one identity commit: append, stage, and the wait. */
export const identityCommitDurationSeconds = new Histogram({
  name: "identity_commit_duration_seconds",
  help: "Duration of an identity ledger commit: durable append, queue staging, and the read-your-writes wait.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

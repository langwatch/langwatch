import { Counter, Histogram, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
const metricNames = [
  "identity_write_gate_read_failures_total",
  "identity_staging_dropped_total",
  "identity_calling_path_apply_failures_total",
  "identity_calling_path_apply_duration_seconds",
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
 * GroupQueue staging of an identity command failed after the durable append
 * and the calling-path apply both landed (ADR-101 §2's pinned order —
 * staging is convergence, not the primary apply). Each drop is a re-apply
 * the queue never runs; the cursor-guarded fold converges on the aggregate's
 * next event or on replay. The `reason` label separates the expected kind
 * from the defective one: `redis_drop` moves only while Redis is down (D02);
 * `sender_unavailable` is a wiring defect — the pipeline exposed no sender —
 * and should never move in a healthy deployment.
 */
export const identityStagingDroppedTotal = new Counter({
  name: "identity_staging_dropped_total",
  help: "Identity command stagings dropped after the durable append; convergence re-apply deferred to the next event or replay.",
  labelNames: ["reason"] as const,
});

/**
 * The calling-path fold apply failed after the durable append. The ceremony
 * still succeeds (the fact is durable; staging or the next event repairs the
 * projection), but read-your-writes is lost for this ceremony — worth paging
 * on if it moves outside a Postgres incident.
 */
export const identityCallingPathApplyFailuresTotal = new Counter({
  name: "identity_calling_path_apply_failures_total",
  help: "Calling-path applies of identity events that failed after the durable append; the projection converges via staging or replay.",
});

/** The D02 latency budget's measurement (ADR-101 §2 dispatch order). */
export const identityCallingPathApplyDurationSeconds = new Histogram({
  name: "identity_calling_path_apply_duration_seconds",
  help: "Duration of the calling-path append+apply for identity ceremonies.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

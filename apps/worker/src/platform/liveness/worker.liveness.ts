/**
 * The worker's liveness policy: where the kubelet asks, and how stale the main
 * loop's heartbeat may get before the answer turns negative.
 *
 * The predicate that applies the budget is not here. It lives inside
 * `LIVENESS_THREAD_SOURCE` (`worker-metrics.server.ts`), because the thread
 * that actually serves the probe is evaluated from a string and can import
 * nothing — so a TypeScript copy of the comparison would be a second
 * definition that no request ever runs, free to drift from the one that does.
 */

/**
 * The worker's liveness path. Deliberately UNAUTHENTICATED and deliberately
 * not `/metrics`.
 *
 * The kubelet needs a path it can call with no credentials, because it has
 * neither of the two things `/metrics` demands. `/metrics` is fail-closed in
 * production (no metrics API key ⇒ 500, and the chart leaves the key unset by
 * default), and an httpGet probe cannot read a Kubernetes Secret, so a
 * secretKeyRef-delivered key can never reach a rendered Authorization header.
 * Probing `/metrics` therefore crash-loops both the default install and the
 * secretKeyRef install. See specs/server/worker-liveness-probe.feature.
 *
 * It answers 200 whenever the event loop is turning enough to accept the
 * connection and run this handler — which is the whole question a liveness
 * probe asks, and strictly more than the old `kill -0 1` could tell us. It
 * carries no telemetry, so leaving it open exposes nothing the bearer gate on
 * `/metrics` was protecting.
 *
 * `charts/langwatch/templates/workers/deployment.yaml` hard-codes this same
 * string in both the startupProbe and the livenessProbe, and
 * `charts/langwatch/tests/e2e.sh` asserts it against a live cluster. Changing
 * it here without changing it there crash-loops the worker fleet.
 */
export const WORKER_LIVENESS_PATH = "/healthz";

/**
 * How stale the main loop's heartbeat may get before `/healthz` reports the
 * process dead.
 *
 * Far beyond any legitimate saturation — a worker chewing through queue
 * catch-up can pin the loop for over a minute of real work, and killing
 * exactly the busiest pods requeues their in-flight jobs and deepens the
 * backlog that caused it — but well short of "the restart never comes".
 */
export const WORKER_HEARTBEAT_STALL_BUDGET_MS = 5 * 60 * 1000;

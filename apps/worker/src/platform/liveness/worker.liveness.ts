/**
 * Worker's liveness policy: where kubelet asks and the heartbeat stall budget. The predicate is
 * in LIVENESS_THREAD_SOURCE (string-eval'd thread with no imports).
 */

/**
 * Worker's liveness path: unauthenticated (kubelet can't provide credentials; /metrics is
 * fail-closed). Answers 200 if event loop is responsive. Hard-coded in deployment.yaml and e2e.sh.
 */
export const WORKER_LIVENESS_PATH = "/healthz";

/**
 * Stall budget: how long heartbeat can be silent before /healthz reports dead. Set high (beyond
 * queue catch-up) but not indefinite.
 */
export const WORKER_HEARTBEAT_STALL_BUDGET_MS = 5 * 60 * 1000;

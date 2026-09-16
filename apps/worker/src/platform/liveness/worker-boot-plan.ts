/**
 * Which subsystems a worker boots. Pulled out as a pure decision (unit-testable). Every worker
 * boots the full stack including voice, each with its own cloudflared tunnel.
 */

/** Every boot stage `startWorkers` knows how to run. */
export type WorkerStageName =
  | "storage-stats"
  | "scenario-processor"
  | "nlp-fetch-teardown"
  | "voice-ws-listener"
  | "anomaly"
  | "spend-spike-anomaly"
  | "usage-stats"
  | "realtime-session-poller"
  | "metrics";

/**
 * Ordered: voice-ws-listener precedes scenario-processor (a race would give
 * Twilio an unbound address), and `metrics` goes first so the liveness
 * thread listens before a slow tunnel boot risks a kubelet crash-loop.
 */
export function resolveWorkerBootPlan(params: {
  shouldStartMetricsServer: boolean;
}): WorkerStageName[] {
  const metrics: WorkerStageName[] = params.shouldStartMetricsServer
    ? ["metrics"]
    : [];

  return [
    ...metrics,
    "storage-stats",
    "voice-ws-listener",
    "scenario-processor",
    "nlp-fetch-teardown",
    "anomaly",
    "spend-spike-anomaly",
    "usage-stats",
    "realtime-session-poller",
  ];
}

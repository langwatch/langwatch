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
 * The ordered stages to boot. voice-ws-listener must precede scenario-processor to close a
 * race: a job claimed between them would give Twilio an address nothing has bound yet.
 *
 * metrics first: the liveness thread must answer the kubelet while the voice
 * tunnel boot, which can take minutes on a cold binary download, is still in
 * flight. A worker boots the tunnel between this plan's resolution and its
 * execution, so putting `metrics` at the head here is what lets the liveness
 * thread be listening before that wait even starts — a pod whose `/healthz`
 * isn't up within the kubelet's liveness budget (prod: 30s initial delay +
 * 6 * 10s period ~= 90s) gets killed and restarted mid-tunnel-mint,
 * crash-looping the whole rollout on a slow GitHub download or slow
 * trycloudflare DNS. `metrics` depends on nothing else in the plan, so moving
 * it first costs nothing.
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

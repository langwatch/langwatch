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
 */
export function resolveWorkerBootPlan(params: {
  shouldStartMetricsServer: boolean;
}): WorkerStageName[] {
  const metrics: WorkerStageName[] = params.shouldStartMetricsServer
    ? ["metrics"]
    : [];

  return [
    "storage-stats",
    "voice-ws-listener",
    "scenario-processor",
    "nlp-fetch-teardown",
    "anomaly",
    "spend-spike-anomaly",
    "usage-stats",
    "realtime-session-poller",
    ...metrics,
  ];
}

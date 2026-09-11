/**
 * Which subsystems a worker process boots.
 *
 * Pulled out of {@link ./startWorkers} as a pure decision so the plan is
 * unit-testable without mocking every lazily imported boot stage.
 * `startWorkers` maps each returned name to its boot call.
 *
 * Every worker boots the full stack, voice included. Each process now opens
 * its OWN cloudflared quick tunnel (or uses an explicit
 * VOICE_PUBLIC_BASE_URL) and stamps its own hostname into the TwiML for calls
 * it places itself, so a call returns to the process that placed it by
 * construction — there is no shared address to contend over, and no reason
 * left to confine voice to a dedicated single-replica deployment.
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
 * The ordered stages to boot. Order matters: later stages may depend on earlier
 * ones (the scenario processor registers the pool a later stage reads), and
 * teardown runs newest-first.
 */
export function resolveWorkerBootPlan(params: {
  shouldStartMetricsServer: boolean;
}): WorkerStageName[] {
  const metrics: WorkerStageName[] = params.shouldStartMetricsServer
    ? ["metrics"]
    : [];

  return [
    "storage-stats",
    "scenario-processor",
    "nlp-fetch-teardown",
    "voice-ws-listener",
    "anomaly",
    "spend-spike-anomaly",
    "usage-stats",
    "realtime-session-poller",
    ...metrics,
  ];
}

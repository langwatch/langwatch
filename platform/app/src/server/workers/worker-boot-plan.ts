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
 *
 * metrics first: the liveness thread must answer the kubelet while the voice
 * tunnel boot, which can take minutes on a cold binary download, is still in
 * flight. `startWorkers` boots the tunnel between this plan's resolution and
 * its execution (see its own doc comment), so putting `metrics` at the head
 * here is what lets the liveness thread be listening before that wait even
 * starts — a pod whose `/healthz` isn't up within the kubelet's liveness
 * budget (prod: 30s initial delay + 6 * 10s period ≈ 90s) gets killed and
 * restarted mid-tunnel-mint, crash-looping the whole rollout on a slow
 * GitHub download or slow trycloudflare DNS. `metrics` depends on nothing
 * else in the plan, so moving it first costs nothing.
 *
 * `voice-ws-listener` deliberately precedes `scenario-processor`. The processor
 * starts claiming queued jobs the moment it boots, and a voice job builds TwiML
 * naming this process's media socket. With the listener behind the processor,
 * a job claimed in the gap between the two would hand Twilio a dial-back
 * address that nothing is bound to yet, and the call would fail on connect.
 * Binding the socket first closes that window; the listener depends on nothing
 * the processor sets up.
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

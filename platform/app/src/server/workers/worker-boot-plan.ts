/**
 * Which subsystems a worker process boots.
 *
 * Pulled out of {@link ./startWorkers} as a pure decision so the
 * VOICE_WORKER_ONLY branch is unit-testable without mocking every lazily
 * imported boot stage. `startWorkers` maps each returned name to its boot call.
 *
 * A normal worker boots the full stack. A voice worker (VOICE_WORKER_ONLY on)
 * boots only what a voice run needs: the scenario processor (filtered to voice
 * jobs), its NLP fetch-dispatcher teardown, the media listener, and metrics.
 * Every other subsystem is skipped, so the voice deployment carries none of the
 * ingestion, anomaly, governance, poller or telemetry load.
 */

/** Every boot stage `startWorkers` knows how to run. */
export type WorkerStageName =
	| "storage-stats"
	| "scenario-processor"
	| "nlp-fetch-teardown"
	| "anomaly"
	| "spend-spike-anomaly"
	| "usage-stats"
	| "realtime-session-poller"
	| "voice-ws-listener"
	| "metrics";

/**
 * The ordered stages to boot. Order matters: later stages may depend on earlier
 * ones (the scenario processor registers the pool a later stage reads), and
 * teardown runs newest-first.
 */
export function resolveWorkerBootPlan(params: {
	voiceWorkerOnly: boolean;
	shouldStartMetricsServer: boolean;
}): WorkerStageName[] {
	const metrics: WorkerStageName[] = params.shouldStartMetricsServer
		? ["metrics"]
		: [];

	if (params.voiceWorkerOnly) {
		return [
			"scenario-processor",
			"nlp-fetch-teardown",
			"voice-ws-listener",
			...metrics,
		];
	}

	return [
		"storage-stats",
		"scenario-processor",
		"nlp-fetch-teardown",
		"anomaly",
		"spend-spike-anomaly",
		"usage-stats",
		"realtime-session-poller",
		...metrics,
	];
}

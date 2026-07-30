/**
 * A langwatch *platform* process (the app server + the workers) must never carry the
 * langwatch SDK's own `LANGWATCH_API_KEY`. With it set, the platform's OTel/SDK
 * bootstrap wires a langwatch exporter and ships the platform's OWN operational
 * telemetry into its OWN trace ingest — a self-referencing feedback loop: every
 * ingested span does more work (Redis, Postgres, ClickHouse) that emits more spans,
 * which get ingested, which… The observed symptom is a runaway `recordSpan` backlog.
 *
 * Run via `langwatchPlatformGuard.boot`, imported first in `instrumentation.node.ts` —
 * the only platform file that calls `setupObservability()` (the exporter-wiring point),
 * itself loaded by exactly the two platform entry points: the Next.js `register()` hook
 * (the app) and `workers.ts`. SDK-client subprocesses that legitimately call
 * `setupObservability()` with a key — the `ai-server` dogfood tool, and the scenario
 * child via `@langwatch/scenario` — do NOT load it, so they are unaffected. We refuse
 * to boot rather than silently self-reference.
 */
export function assertPlatformHasNoLangwatchApiKey(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.LANGWATCH_API_KEY) {
    throw new Error(
      "LANGWATCH_API_KEY must not be set on a langwatch platform process — it makes the " +
        "platform self-reference its own trace ingest (a feedback loop).",
    );
  }
}

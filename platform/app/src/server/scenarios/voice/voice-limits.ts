/**
 * Operator limits for voice runs, read from the environment.
 *
 * Two knobs, both with the defaults the AC names:
 *   - VOICE_CALL_MAX_SECONDS   (default 300): the wall-clock a single call may
 *     run before LangWatch ends it and the run is judged on what was said.
 *   - VOICE_RUNS_MAX_CONCURRENT (default 2, per pod per project): how many
 *     voice runs a project may execute at once on a single execution pod; the
 *     rest wait in the queue. The gate is an in-memory map inside that pod's
 *     execution pool (see `voice-concurrency-gate.ts`), so it does not see
 *     other pods — the effective ceiling for a project is this number times
 *     the pod count, not this number alone.
 *
 * Read from `process.env` directly (with a tolerant parse) rather than the
 * validated env schema so the child process and the worker pool can both reach
 * them without threading the config object, the same way the child already
 * reads its telemetry env.
 */

export const VOICE_CALL_MAX_SECONDS_DEFAULT = 300;
export const VOICE_RUNS_MAX_CONCURRENT_DEFAULT = 2;

/** Bounded timeout for the voice HTTP calls that must not hang forever: the
 *  mint request and the call-record fetch. Long enough for the provider's
 *  usual latency, short enough that a stuck upstream still frees the caller. */
export const VOICE_HTTP_TIMEOUT_MS = 15_000;

/** Parse a positive integer env var, falling back to `fallback` for anything
 *  missing, empty, non-numeric, non-integer or non-positive. */
export function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function voiceCallMaxSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveIntEnv(
    env.VOICE_CALL_MAX_SECONDS,
    VOICE_CALL_MAX_SECONDS_DEFAULT,
  );
}

export function voiceRunsMaxConcurrent(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveIntEnv(
    env.VOICE_RUNS_MAX_CONCURRENT,
    VOICE_RUNS_MAX_CONCURRENT_DEFAULT,
  );
}

/**
 * Operator limits for voice runs, read from the environment.
 *
 * Two knobs, both with the defaults the AC names:
 *   - VOICE_CALL_MAX_SECONDS   (default 300): the wall-clock a single call may
 *     run before LangWatch ends it and the run is judged on what was said.
 *   - VOICE_RUNS_MAX_CONCURRENT (default 2, per project): how many voice runs
 *     a project may execute at once; the rest wait in the queue.
 *
 * Read from `process.env` directly (with a tolerant parse) rather than the
 * validated env schema so the child process and the worker pool can both reach
 * them without threading the config object, the same way the child already
 * reads its telemetry env.
 */

export const VOICE_CALL_MAX_SECONDS_DEFAULT = 300;
export const VOICE_RUNS_MAX_CONCURRENT_DEFAULT = 2;

/** Parse a positive integer env var, falling back to `fallback` for anything
 *  missing, empty, non-numeric or non-positive. */
export function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
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

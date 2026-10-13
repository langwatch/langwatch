// Operator limits from environment: VOICE_CALL_MAX_SECONDS (default 300) and
// VOICE_RUNS_MAX_CONCURRENT (default 2 per process/project).

export const VOICE_CALL_MAX_SECONDS_DEFAULT = 300;
export const VOICE_RUNS_MAX_CONCURRENT_DEFAULT = 2;

/** Node clamps any `setTimeout` delay above this to 1ms (the delay is a
 *  32-bit signed int internally), so a call-limit timer armed with the raw
 *  env value would fire almost immediately instead of never. */
export const VOICE_CALL_MAX_SECONDS_CEILING = 2_147_483;

/** Bounded timeout for the voice HTTP calls that must not hang forever: the
 *  mint request and the call-record fetch. Long enough for the provider's
 *  usual latency, short enough that a stuck upstream still frees the caller. */
export const VOICE_HTTP_TIMEOUT_MS = 15_000;

/** Parse a positive integer env var, falling back to `fallback` for anything
 *  missing, empty, non-numeric, non-integer or non-positive. */
export function parsePositiveIntEnv({
  raw,
  fallback,
}: {
  raw: string | undefined;
  fallback: number;
}): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function voiceCallMaxSeconds(env: NodeJS.ProcessEnv): number {
  const parsed = parsePositiveIntEnv({
    raw: env.VOICE_CALL_MAX_SECONDS,
    fallback: VOICE_CALL_MAX_SECONDS_DEFAULT,
  });
  return Math.min(parsed, VOICE_CALL_MAX_SECONDS_CEILING);
}

/**
 * Whether a call that ran for `durationMs` reached the call limit.
 *
 * The limit is applied in whole seconds: the countdown that ends a browser
 * call fires once `floor(elapsed / 1000) >= maxCallSeconds`, so a call the
 * limit ended spans at least `maxCallSeconds * 1000` milliseconds by the time
 * it is hung up, and one a person ended early does not. That makes the span a
 * finding the server can make for itself, where a flag in the finish body was
 * only ever the browser's claim (#8028).
 */
export function callReachedLimit({
  durationMs,
  maxCallSeconds,
}: {
  durationMs: number;
  maxCallSeconds: number;
}): boolean {
  return durationMs >= maxCallSeconds * 1000;
}

export function voiceRunsMaxConcurrent(env: NodeJS.ProcessEnv): number {
  return parsePositiveIntEnv({
    raw: env.VOICE_RUNS_MAX_CONCURRENT,
    fallback: VOICE_RUNS_MAX_CONCURRENT_DEFAULT,
  });
}

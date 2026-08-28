/**
 * The client-side fetch deadline for scenario execution calls to nlpgo's
 * `/go/studio/execute_sync`, and the platform's own ceiling on how long a
 * scenario worker may hold that socket open.
 *
 * Single source for both `code-agent.adapter.ts` and
 * `workflow-agent.adapter.ts` — they used to each hold their own copy of
 * the deadline (one env-configurable, one not), which is how a live
 * production bug happened: the engine's code-block ceiling was raised
 * 60s -> 600s (lw#7640), but the client's independently-configured 120s
 * abort was never told, so it started cutting off runs the engine was
 * still legitimately working on.
 *
 * The fix is not a second floor knob to keep in sync by hand — it's for
 * the client deadline to be DERIVED from the engine's own ceiling, so the
 * two cannot drift apart again. `resolveFloorFetchTimeoutMs` below reads
 * `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`, the exact env var
 * `services/nlpgo/config.go` reads for the same setting, and adds a fixed
 * headroom. One operator-set number, read on both sides of the socket.
 */

/**
 * The engine's own knob for the code block's execution ceiling — see
 * `services/nlpgo/config.go` (`Engine.CodeBlockTimeoutSeconds`, tag
 * `env:"NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS"`). Read here under the
 * *same* name so an operator sets it once and both nlpgo and this client
 * agree on the ceiling; there is deliberately no separate client-side name
 * for the same concept.
 *
 * @internal Exported for testing and for {@link ../scenarios/execution/child-environment.ts}.
 */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV =
  "NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS";

/**
 * Used when {@link NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV} is unset or
 * unusable here. This is NOT an independent default to rely on — it is a
 * copy of the engine's own fallback
 * (`services/nlpgo/app/engine/blocks/codeblock/codeblock.go:115`,
 * `opts.DefaultTimeout = 600 * time.Second`), so that when the operator
 * hasn't set the var anywhere, this client falls back to the exact number
 * the engine falls back to. Keep the two in sync if the Go default ever
 * changes.
 */
const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS = 600;

/**
 * Slack the client's socket hold gets ABOVE the engine's code-block
 * ceiling (and above an agent's own `timeoutMs` budget, when the code
 * agent has one), so the engine gets to enforce and REPORT its own
 * timeout instead of this client aborting the connection first while the
 * engine is still legitimately working.
 *
 * Deliberately not env-configurable: it exists purely to absorb
 * network/serialization latency around the engine's own deadline. Making
 * it independently operator-tunable would recreate the exact drift this
 * module exists to prevent — there would again be two numbers, set in two
 * places, that have to be kept in sync by hand.
 */
export const NLP_FETCH_HEADROOM_MS = 30_000;

/** Operator knob naming the platform's maximum for one scenario turn. */
export const NLP_FETCH_MAX_TIMEOUT_ENV = "NLP_FETCH_MAX_TIMEOUT_MS";

/** Used when {@link NLP_FETCH_MAX_TIMEOUT_ENV} is unset or unusable (15 minutes). */
export const NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS = 900_000;

/**
 * Parses an env var holding a count of SECONDS as a positive, finite
 * number, converts to milliseconds, and falls back on anything that
 * isn't one.
 *
 * Clamp, never reject: unset, empty, non-numeric, non-finite, zero and
 * negative all read as "use the default" — a nonsensical value must not
 * fail the scenario run, the same contract the engine keeps for its own
 * copy of this parse (`services/nlpgo/cmd/root.go`).
 */
function resolvePositiveSecondsEnvAsMs(
  name: string,
  fallbackSeconds: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallbackSeconds * 1000;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackSeconds * 1000;
  }
  return parsed * 1000;
}

/** Same parse as {@link resolvePositiveSecondsEnvAsMs}, but the env var is already milliseconds. */
function resolvePositiveMsEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallbackMs;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return parsed;
}

/**
 * The client-side floor for one NLP fetch, in milliseconds: the engine's
 * own code-block ceiling plus {@link NLP_FETCH_HEADROOM_MS}.
 *
 * Read per call rather than cached, so a worker started before the
 * variable was set is not pinned to a stale value, and so tests can
 * exercise the real parse without reloading the module.
 *
 * The scenario child process is spawned with a fixed env allowlist
 * (`buildChildProcessEnv` in `../scenarios/execution/child-environment.ts`),
 * which is what carries `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS` from the
 * operator's environment to here, and it runs under `SKIP_ENV_VALIDATION`,
 * which makes the validated `~/env.mjs` proxy return raw strings with no
 * defaults applied. Hence the direct read.
 *
 * @internal Exported for testing.
 */
export function resolveFloorFetchTimeoutMs(): number {
  const engineCeilingMs = resolvePositiveSecondsEnvAsMs(
    NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV,
    NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  );
  return engineCeilingMs + NLP_FETCH_HEADROOM_MS;
}

/**
 * The platform's own maximum for one scenario turn, from the environment.
 *
 * This is a bound on how long a scenario worker will hold a socket open,
 * and nothing else. The engine ceiling
 * (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`) bounds how long the agent's
 * *Python* may run; it does not bound this process. Without a maximum
 * here, an agent config carrying an absurd `timeoutMs` parks a worker on a
 * socket for as long as the number says — up to ~24.9 days, where
 * `setTimeout` stops honoring the delay at all.
 *
 * The default of 15 minutes sits above {@link resolveFloorFetchTimeoutMs}'s
 * own default (630s), so on default settings the engine gets to enforce
 * and REPORT its timeout before this deadline fires. That ordering is a
 * consequence of the two defaults, NOT an invariant this code enforces: an
 * operator who raises the engine ceiling past this default must raise
 * this one too, or the platform aborts the fetch first and the caller
 * sees a generic fetch-side `error.kind: "timeout"` instead of the
 * engine's diagnosis.
 *
 * @internal Exported for testing.
 */
export function resolveMaxFetchTimeoutMs(): number {
  return resolvePositiveMsEnv(
    NLP_FETCH_MAX_TIMEOUT_ENV,
    NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS,
  );
}

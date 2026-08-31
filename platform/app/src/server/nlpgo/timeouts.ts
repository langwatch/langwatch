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

import {
  Agent,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from "undici";

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
 *
 * Exported because it is the ONLY copy of the engine default on this side:
 * every other fallback to it — the Lambda clamp included — imports this
 * rather than restating 600, which is the drift this module exists to stop.
 */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS = 600;

/**
 * The engine's own default silence budget for an SSE stream —
 * `NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS`, `httpapi.DefaultStreamIdleTimeout`
 * in `services/nlpgo/adapters/httpapi/handlers.go`.
 *
 * A code block that runs longer than this emits nothing while it runs, so the
 * stream is torn down underneath it and the caller never sees the engine's
 * verdict. That makes this an upper bound on any code-block ceiling, alongside
 * the Lambda invocation ceiling — see {@link clampCodeBlockTimeoutSeconds} and
 * the chart's own `langwatch.codeBlockTimeoutSeconds` helper, which refuses a
 * value at or above it.
 *
 * Not env-configurable here on purpose: the platform does not set the engine's
 * idle timeout, it only has to stay under whatever the engine's default is.
 */
export const NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS = 720;

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
 * Parses an env var holding a count of SECONDS as a positive whole number,
 * converts to milliseconds, and falls back on anything that isn't one.
 *
 * Clamp, never reject: unset, empty, non-numeric, non-finite, fractional,
 * zero and negative all read as "use the default" — a nonsensical value must
 * not fail the scenario run, the same contract the engine keeps for its own
 * copy of this parse (`services/nlpgo/cmd/root.go`).
 *
 * Fractional is rejected rather than honoured so this parse agrees with the
 * other reader of the same variable, `clampCodeBlockTimeoutSeconds` in
 * `../../optimization_studio/server/lambda/index.ts`, which takes integers
 * only. When the two disagreed, "0.5" made the Lambda run on the 600s default
 * while this side derived a 30.5s deadline and cut every turn off against it.
 */
function resolvePositiveSecondsEnvAsMs({
  name,
  fallbackSeconds,
}: {
  name: string;
  fallbackSeconds: number;
}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallbackSeconds * 1000;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallbackSeconds * 1000;
  }
  return parsed * 1000;
}

/** Same parse as {@link resolvePositiveSecondsEnvAsMs}, but the env var is already milliseconds. */
function resolvePositiveMsEnv({
  name,
  fallbackMs,
}: {
  name: string;
  fallbackMs: number;
}): number {
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
  const engineCeilingMs = resolvePositiveSecondsEnvAsMs({
    name: NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV,
    fallbackSeconds: NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  });
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
  return resolvePositiveMsEnv({
    name: NLP_FETCH_MAX_TIMEOUT_ENV,
    fallbackMs: NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS,
  });
}

/**
 * Cache for {@link createNlpFetchDispatcher}, keyed by the effective
 * `timeoutMs`. An `Agent` owns its own connection pool, so building a fresh
 * one per call — the original behaviour here — opened a new pool on every
 * scenario fetch that was never reused and never destroyed: a socket/FD
 * leak under load that also defeated keep-alive to nlpgo. `timeoutMs` comes
 * from env-derived config (`resolveFloorFetchTimeoutMs`,
 * `resolveMaxFetchTimeoutMs`), so the key cardinality is small and fixed
 * for the process's life — no eviction policy is needed.
 */
const dispatchersByTimeoutMs = new Map<number, Dispatcher>();

/**
 * Undici's own per-request timeouts — `headersTimeout`/`bodyTimeout`, default
 * 300_000ms each — live on the DISPATCHER (the `Agent`), not on the request.
 * An `AbortController` deadline passed as `signal` cannot raise them: past
 * 300s of a still-open connection, undici throws `HeadersTimeoutError`
 * regardless of how far out the abort is armed. This is what let a client
 * deadline raised to 630s (`resolveFloorFetchTimeoutMs`, lw#7640) still get
 * cut off at 300s in production — the abort signal was never the ceiling
 * that mattered.
 *
 * This dispatcher may only be given to the `fetch` exported by `undici`, never
 * to the global one. Node's global `fetch` is bound to the undici bundled with
 * the Node runtime — 7.29.0 on Node 24, against 8.x here — and builds a request
 * handler of the older shape, which this package rejects up front with
 * `InvalidArgumentError: invalid onRequestStart method`. Pairing the two failed
 * every scenario agent call in about a second, before a byte left the process.
 * {@link FetchInitWithDispatcher} is typed so that mistake cannot compile.
 *
 * Memoized by `timeoutMs` — see {@link dispatchersByTimeoutMs}. Call
 * {@link closeNlpFetchDispatchers} on shutdown to release the pooled
 * connections this holds open.
 */
export function createNlpFetchDispatcher({
  timeoutMs,
}: {
  timeoutMs: number;
}): Dispatcher {
  const cached = dispatchersByTimeoutMs.get(timeoutMs);
  if (cached) {
    return cached;
  }
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  dispatchersByTimeoutMs.set(timeoutMs, dispatcher);
  return dispatcher;
}

/**
 * Closes every dispatcher {@link createNlpFetchDispatcher} has cached and
 * clears the cache, so a later call builds a fresh `Agent` instead of
 * reusing a closed one. Wired into process shutdown from
 * `~/server/workers/startWorkers.ts`.
 */
export async function closeNlpFetchDispatchers(): Promise<void> {
  const dispatchers = [...dispatchersByTimeoutMs.values()];
  dispatchersByTimeoutMs.clear();
  await Promise.all(dispatchers.map((dispatcher) => dispatcher.close()));
}

/**
 * The request init for a call that carries {@link createNlpFetchDispatcher}'s
 * dispatcher.
 *
 * Deliberately undici's own `RequestInit` (which already declares
 * `dispatcher`), not the DOM-lib one the global `fetch` takes. The two are not
 * assignable to each other, so this type is what makes handing the dispatcher
 * to the global `fetch` a compile error rather than a production outage — see
 * {@link createNlpFetchDispatcher} for what that outage looked like.
 */
export type FetchInitWithDispatcher = UndiciRequestInit;

/**
 * Lambda's own hard invocation ceiling. The code-block timeout override must
 * stay under this or Lambda kills the invocation before nlpgo reports its own
 * timeout — see {@link clampCodeBlockTimeoutSeconds}.
 *
 * Deliberately not env-configurable: it is a platform-wide hard boundary
 * set by AWS Lambda's own function timeout ceiling.
 */
export const LAMBDA_INVOCATION_TIMEOUT_SECONDS = 900; // 15 minutes

/**
 * Safety margin subtracted from {@link LAMBDA_INVOCATION_TIMEOUT_SECONDS} to
 * compute the clamp ceiling for nlpgo's code-block timeout override. Leaves
 * nlpgo's own timeout-reporting a moment to run before Lambda kills the
 * invocation.
 *
 * Deliberately not env-configurable: it exists purely to absorb nlpgo's own
 * timeout-handling latency. Making it independently operator-tunable would
 * recreate the exact drift problem this module's timeout coordination exists
 * to prevent — there would again be two numbers that have to be kept in sync
 * by hand.
 */
export const CODE_BLOCK_TIMEOUT_SAFETY_MARGIN_SECONDS = 10;

/**
 * Desired memory allocation, in MB, for every per-project langwatch_nlp Lambda.
 *
 * 2048 MB (was 1024) gives Python multiprocessing.fork() enough RSS headroom
 * when the bundled image runs nlpgo + uvicorn + litellm in the same container.
 * At 1024 MB observed Max Memory Used hit 805/1024 MB mid-request on lw-dev
 * (TEST H, 2026-04-28); fork() would fail to clone parent pages and the uvicorn
 * worker pool crashed, cascading to /studio/* 502s. 2048 MB also doubles
 * Lambda's allocated CPU (Lambda allocates CPU proportional to memory;
 * ~0.58 vCPU at 1024 → ~1.17 vCPU at 2048), shaving cold-start init time too.
 *
 * Already-created Lambdas are brought up to this value automatically by
 * `reconcileProjectLambdaConfig` on the next ARN resolution.
 */
export const NLP_LAMBDA_MEMORY_SIZE_MB = 2048;

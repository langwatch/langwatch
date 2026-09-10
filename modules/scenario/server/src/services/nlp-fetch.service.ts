/**
 * The client-side fetch deadline for nlpgo's /go/studio/execute_sync,
 * single-sourced for both code-agent and workflow-agent adapters after a
 * production bug (lw#7640): a raised engine ceiling left an independently-configured client abort cutting off still-legitimate runs. The deadline is DERIVED from the engine's own ceiling, which the composition root reads under the engine's own name, so the two cannot drift apart again.
 */

import { Agent, type Dispatcher, type RequestInit as UndiciRequestInit } from "undici";

/**
 * The engine's own code-block ceiling env var
 * (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`, `services/nlpgo/config.go`), read under the *same* name so an operator sets it once for both sides — no separate client-side name exists.
 * @internal Exported for testing and the child-process environment allowlist.
 */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV =
  "NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS";

/**
 * Used when {@link NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV} is unset —
 * a copy of the engine's own fallback (codeblock.go:115,
 * `opts.DefaultTimeout = 600s`), kept in sync by hand if the Go default changes. Exported as the ONLY copy on this side; every other fallback (Lambda clamp included) imports this rather than restating 600.
 */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS = 600;

/**
 * The engine's own SSE silence budget
 * (`NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS`, handlers.go). A code block
 * running longer emits nothing, so the stream is torn down before the caller sees the verdict — an upper bound on any code-block ceiling (see {@link clampCodeBlockTimeoutSeconds}). Not env-configurable: the platform only has to stay under the engine's own default.
 */
export const NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS = 720;

/**
 * Slack the client's socket hold gets ABOVE the engine's code-block
 * ceiling (and the agent's own budget, if longer), so the engine enforces
 * and REPORTS its own timeout rather than this client aborting first. Deliberately not env-configurable — tunability here would recreate the exact hand-kept-in-sync drift this module exists to prevent.
 */
export const NLP_FETCH_HEADROOM_MS = 30_000;

/** Operator knob naming the platform's maximum for one scenario turn. */
export const NLP_FETCH_MAX_TIMEOUT_ENV = "NLP_FETCH_MAX_TIMEOUT_MS";

/** Used when {@link NLP_FETCH_MAX_TIMEOUT_ENV} is unset or unusable (15 minutes). */
export const NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS = 900_000;

/**
 * The two operator knobs above, as the composition root read them. Both are
 * numbers a process parsed out of its own environment; anything that is not a
 * usable one is clamped to the default here rather than refused.
 */
export type NlpFetchTimeouts = {
  /** {@link NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV}, in seconds. */
  engineCodeBlockTimeoutSeconds?: number;
  /** {@link NLP_FETCH_MAX_TIMEOUT_ENV}, in milliseconds. */
  maxTimeoutMs?: number;
};

/**
 * Clamp, never reject, matching the engine's own parse. Fractional is
 * rejected to agree with the Lambda clamp's integer-only rule.
 */
function positiveWholeSecondsAsMs({
  value,
  fallbackSeconds,
}: {
  value: number | undefined;
  fallbackSeconds: number;
}): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallbackSeconds * 1000;
  }
  return value * 1000;
}

/** Same clamp as {@link positiveWholeSecondsAsMs}, but the value is already milliseconds. */
function positiveMs({ value, fallbackMs }: { value: number | undefined; fallbackMs: number }) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }
  return value;
}

/**
 * The client-side floor for one NLP fetch: the engine's own code-block
 * ceiling plus {@link NLP_FETCH_HEADROOM_MS}.
 */
function floorFetchTimeoutMs(timeouts: NlpFetchTimeouts): number {
  const engineCeilingMs = positiveWholeSecondsAsMs({
    value: timeouts.engineCodeBlockTimeoutSeconds,
    fallbackSeconds: NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  });
  return engineCeilingMs + NLP_FETCH_HEADROOM_MS;
}

/**
 * The platform's own maximum socket-hold for one scenario turn. Its 15-minute
 * default sits above {@link floorFetchTimeoutMs}'s but that ordering is NOT enforced.
 */
function maxFetchTimeoutMs(timeouts: NlpFetchTimeouts): number {
  return positiveMs({ value: timeouts.maxTimeoutMs, fallbackMs: NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS });
}

/**
 * Dispatcher cache keyed by effective `timeoutMs`: building a fresh `Agent`
 * per call (the original behaviour) leaked a socket/FD pool on every
 * scenario fetch and defeated keep-alive. `timeoutMs` comes from the process's own configuration, so key cardinality is small and fixed for its life — no eviction needed.
 */
const dispatchersByTimeoutMs = new Map<number, Dispatcher>();

/**
 * Undici's own headersTimeout/bodyTimeout (300s default) live on the
 * DISPATCHER, not the request — an `AbortController` signal cannot raise
 * them, which is how a client deadline raised to 630s (lw#7640) still got cut off at 300s in production. Give this dispatcher only to undici's own `fetch`, never the global one (version-mismatched, fails fast); {@link FetchInitWithDispatcher} makes that mistake a compile error. Memoized by `timeoutMs`; call {@link NlpFetchAdapter.close} on shutdown.
 */
function createNlpFetchDispatcher({ timeoutMs }: { timeoutMs: number }): Dispatcher {
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
 * Closes every cached dispatcher and clears the cache, so a later call
 * builds a fresh `Agent` instead of reusing a closed one. Wired into the
 * worker process's own shutdown.
 */
async function closeNlpFetchDispatchers(): Promise<void> {
  const dispatchers = [...dispatchersByTimeoutMs.values()];
  dispatchersByTimeoutMs.clear();
  await Promise.all(dispatchers.map((dispatcher) => dispatcher.close()));
}

/**
 * The undici transport every scenario call to nlpgo goes through: the
 * operator's deadlines, and the memoized dispatcher that carries them.
 */
export class NlpFetchAdapter {
  static create({ timeouts }: { timeouts?: NlpFetchTimeouts } = {}): NlpFetchAdapter {
    return new NlpFetchAdapter(timeouts ?? {});
  }

  /**
   * The two knobs as one process's environment spells them, for a
   * composition root to read its own environment with. Anything unusable
   * stays unusable and is clamped to the default where it is applied.
   */
  static timeoutsFromEnvironment(
    environment: Record<string, string | undefined>,
  ): NlpFetchTimeouts {
    return {
      engineCodeBlockTimeoutSeconds: Number(
        environment[NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV],
      ),
      maxTimeoutMs: Number(environment[NLP_FETCH_MAX_TIMEOUT_ENV]),
    };
  }

  private constructor(private readonly timeouts: NlpFetchTimeouts) {}

  /** The deadline derived from the engine's own code-block ceiling. */
  floorTimeoutMs(): number {
    return floorFetchTimeoutMs(this.timeouts);
  }

  /** This platform's own maximum for one scenario turn. */
  maxTimeoutMs(): number {
    return maxFetchTimeoutMs(this.timeouts);
  }

  /** The pooled dispatcher for one deadline, built once per distinct value. */
  dispatcher({ timeoutMs }: { timeoutMs: number }): Dispatcher {
    return createNlpFetchDispatcher({ timeoutMs });
  }

  /** Releases every pooled connection this process holds open to nlpgo. */
  async close(): Promise<void> {
    await closeNlpFetchDispatchers();
  }
}

/**
 * The request init for a call carrying {@link NlpFetchAdapter.dispatcher}'s
 * dispatcher — deliberately undici's own `RequestInit`, not the DOM-lib
 * one, so handing the dispatcher to the global `fetch` is a compile error, not the outage {@link NlpFetchAdapter.dispatcher} describes.
 */
export type FetchInitWithDispatcher = UndiciRequestInit;

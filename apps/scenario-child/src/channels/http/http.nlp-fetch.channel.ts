import { Agent, type Dispatcher } from "undici";

import {
  NLP_FETCH_MAX_TIMEOUT_DEFAULT_MS,
  NLP_FETCH_MAX_TIMEOUT_ENV,
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV,
  NLP_FETCH_HEADROOM_MS,
  type NlpFetchChannel,
  type NlpFetchTimeouts,
} from "../nlp-fetch.channel.ts";

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
function positiveMs({
  value,
  fallbackMs,
}: {
  value: number | undefined;
  fallbackMs: number;
}): number {
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
 * Dispatcher cache keyed by `timeoutMs`: building fresh Agent per call leaked
 * socket/FD pool and defeated keep-alive. Small fixed cardinality, no eviction needed.
 */
const dispatchersByTimeoutMs = new Map<number, Dispatcher>();

/**
 * Undici's own headersTimeout/bodyTimeout (300s default) live on DISPATCHER, not request —
 * AbortController cannot raise them. Give only to undici's `fetch`, never global one.
 * {@link FetchInitWithDispatcher} makes that mistake a compile error. Memoized by timeoutMs.
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
 * builds a fresh `Agent` instead of reusing a closed one. Reached through
 * {@link HttpNlpFetchChannel.close}, which the worker's shutdown calls.
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
export class HttpNlpFetchChannel implements NlpFetchChannel {
  static create({ timeouts }: { timeouts?: NlpFetchTimeouts } = {}): HttpNlpFetchChannel {
    return new HttpNlpFetchChannel(timeouts ?? {});
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

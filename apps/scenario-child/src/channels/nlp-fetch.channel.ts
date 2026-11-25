/**
 * The client-side fetch deadline for nlpgo's /go/studio/execute_sync, single-sourced for
 * both adapters after lw#7640: raised engine ceiling left independent client abort cutting
 * off still-legitimate runs. Deadline derived from engine's own ceiling so they cannot drift.
 */

import type { Dispatcher, RequestInit as UndiciRequestInit } from "undici";

/**
 * The engine's own code-block ceiling env var (`NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`),
 * read under the same name so operator sets it once — no separate client-side name.
 * @internal Exported for testing and child-process environment allowlist.
 */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV =
  "NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS";

/**
 * Used when {@link NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS_ENV} is unset — engine's own fallback
 * (codeblock.go:115). Exported as the ONLY copy; all other fallbacks import this rather than
 * restating 600.
 */
export const NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS = 600;

/**
 * The engine's own SSE silence budget (`NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS`).
 * Running longer emits nothing; stream torn down before caller sees verdict. Upper bound
 * on any code-block ceiling. Not env-configurable.
 */
export const NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS = 720;

/**
 * Slack above engine's code-block ceiling so engine enforces and reports its timeout,
 * not client abort first. Not env-configurable — tunability recreates the drift this
 * module prevents.
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
 * Request init carrying {@link NlpFetchChannel.dispatcher}: deliberately undici's own
 * RequestInit, not DOM-lib, so handing dispatcher to global fetch is a compile error.
 */
export type FetchInitWithDispatcher = UndiciRequestInit;

/** The undici transport every scenario call to nlpgo goes through. */
export interface NlpFetchChannel {
  floorTimeoutMs(): number;
  maxTimeoutMs(): number;
  dispatcher(input: { timeoutMs: number }): Dispatcher;
  close(): Promise<void>;
}

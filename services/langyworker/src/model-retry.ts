/**
 * The retry for a model call that failed for a transient reason: an overloaded
 * provider, a dropped stream, a network error, a timeout, a 5xx or a 429.
 *
 * It runs inside pi's own retry loop, which is the right place for it: pi drops
 * the failed assistant message and makes the same call again against the
 * conversation as it stands, so every tool call that already ran keeps its
 * result and nothing the turn did runs twice. pi decides what to retry and how
 * long to wait with two methods of its session; this module replaces both with
 * the policy below (which errors, how many times, the backoff with jitter and a
 * wait the provider names) and leaves the loop, the abort and the events to pi.
 *
 * The relay (services/langyagent/adapters/otelrelay/llmretry.go) still re-sends
 * a rejected 429 by its Retry-After header before the worker sees it; this
 * retry covers what the relay cannot, a failure inside a stream already
 * answered 200.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Retries after the first failed call; the panel reads "Retrying (n of 5)". */
export const MODEL_RETRY_MAX_ATTEMPTS = 5;

/** The first wait. Each retry doubles it: 1, 2, 4, 8 and 16 seconds. */
export const MODEL_RETRY_BASE_DELAY_MS = 1_000;

/** How far a wait is shifted at random, as a share of it, either way. */
export const MODEL_RETRY_JITTER = 0.2;

/** A wait the provider names past this is not waited out: the failure stands. */
export const MODEL_RETRY_MAX_NAMED_WAIT_MS = 60_000;

/** The slice of a pi assistant message the policy reads. */
export type FailedModelCall = {
  stopReason?: string;
  errorMessage?: string;
};

/**
 * Plan limits and billing: deterministic until a window or an invoice resets,
 * so a retry would be answered the same way. The codes match the relay's
 * hardLimitReasonCodes (llmproxy.go).
 */
const PLAN_LIMIT_PATTERN =
  /usage_limit_reached|codex_plan_limit|insufficient_quota|billing_hard_limit_reached|quota exceeded|out of budget|credit balance/i;

/** The wording providers, SDKs and transports use for a failure worth another try. */
const TRANSIENT_PATTERN = new RegExp(
  [
    "overloaded",
    "rate.?limit",
    "too many requests",
    "service.?unavailable",
    "server.?error",
    "internal.?error",
    "bad gateway",
    "gateway.?time.?out",
    "network.?error",
    "connection.?(error|refused|reset|lost|closed)",
    "econnreset",
    "econnrefused",
    "etimedout",
    "epipe",
    "other side closed",
    "fetch failed",
    "getaddrinfo",
    "eai_again",
    "socket hang up",
    "timed? ?out",
    "timeout",
    "terminated",
    "ended without",
    "stream ended",
    "premature close",
    "try (your request )?again",
    "please retry",
  ].join("|"),
  "i",
);

/**
 * The HTTP status an SDK error message opens with ("429 Rate limit reached",
 * "400 {...}"), or undefined when it names none.
 */
export function leadingStatus(errorMessage: string): number | undefined {
  const match = /^\s*(\d{3})\b/.exec(errorMessage);
  if (!match?.[1]) return undefined;
  const status = Number(match[1]);
  return status >= 100 && status < 600 ? status : undefined;
}

/**
 * Whether a failed model call is worth another try. A status the message
 * opens with decides first: 408, 429 and 5xx are transient, every other 4xx
 * is a refusal (validation, permission, a request the provider will refuse the
 * same way). With no status, the wording decides. A plan limit never retries.
 */
export function isTransientModelFailure(call: FailedModelCall): boolean {
  if (call.stopReason !== "error") return false;
  const message = call.errorMessage ?? "";
  if (message === "") return false;
  if (PLAN_LIMIT_PATTERN.test(message)) return false;
  const status = leadingStatus(message);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return TRANSIENT_PATTERN.test(message);
}

/**
 * The wait a provider names in its message ("Please try again in 20s",
 * "try again in 820ms", "Retry-After: 3"), in milliseconds.
 */
export function namedWaitMs(errorMessage: string): number | undefined {
  const inPhrase = /try again in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?)\b/i.exec(
    errorMessage,
  );
  if (inPhrase?.[1] && inPhrase[2]) {
    const value = Number(inPhrase[1]);
    return inPhrase[2].toLowerCase().startsWith("m") ? value : value * 1_000;
  }
  const header = /retry[- ]after[":\s]+(\d+(?:\.\d+)?)/i.exec(errorMessage);
  if (header?.[1]) return Number(header[1]) * 1_000;
  return undefined;
}

/**
 * The wait before retry number `attempt` (from 1), or null when the provider
 * named a wait too long to take. A named wait is taken as named; otherwise the
 * backoff doubles from MODEL_RETRY_BASE_DELAY_MS, shifted by up to
 * MODEL_RETRY_JITTER either way so retries from many turns do not line up.
 */
export function retryDelayMs({
  attempt,
  errorMessage,
  random = Math.random,
}: {
  attempt: number;
  errorMessage: string;
  random?: () => number;
}): number | null {
  const named = namedWaitMs(errorMessage);
  if (named !== undefined) {
    return named > MODEL_RETRY_MAX_NAMED_WAIT_MS ? null : Math.ceil(named);
  }
  const backoff = MODEL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  const shift = backoff * MODEL_RETRY_JITTER * (2 * random() - 1);
  return Math.max(0, Math.round(backoff + shift));
}

/**
 * The private members of pi's AgentSession (0.84.2) the retry takes over.
 * model-retry.test.ts fails when a pi upgrade renames them.
 */
type PiRetryInternals = {
  _retryAttempt: number;
  _retryAbortController: AbortController | undefined;
  _emit: (event: {
    type: "auto_retry_start" | "auto_retry_end";
    attempt: number;
    maxAttempts?: number;
    delayMs?: number;
    errorMessage?: string;
    success?: boolean;
    finalError?: string;
  }) => void;
  _isRetryableError: (message: FailedModelCall) => boolean;
  _prepareRetry: (message: FailedModelCall) => Promise<boolean>;
  agent: { state: { messages: { role?: string }[] } };
};

/** Resolves after `ms`, or rejects at once when `signal` aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Put the policy into a pi session. The settings passed to pi must enable its
 * retry (session.ts), since pi only enters the loop when they do.
 */
export function installModelRetry({
  session,
  random = Math.random,
  sleep = abortableSleep,
}: {
  session: AgentSession;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): void {
  const internals = session as unknown as PiRetryInternals;

  internals._isRetryableError = (message) => isTransientModelFailure(message);

  internals._prepareRetry = async (message) => {
    const attempt = internals._retryAttempt + 1;
    if (attempt > MODEL_RETRY_MAX_ATTEMPTS) return false;
    const errorMessage = message.errorMessage || "Unknown error";
    const delayMs = retryDelayMs({ attempt, errorMessage, random });
    if (delayMs === null) return false;
    internals._retryAttempt = attempt;
    // Held before the attempt is announced, so a stop that answers the
    // announcement still ends the wait.
    const controller = new AbortController();
    internals._retryAbortController = controller;
    internals._emit({
      type: "auto_retry_start",
      attempt,
      maxAttempts: MODEL_RETRY_MAX_ATTEMPTS,
      delayMs,
      errorMessage,
    });
    // The failed answer leaves the agent's context (the session file keeps it),
    // so the call is made again from the last tool result or user message.
    const messages = internals.agent.state.messages;
    if (messages.at(-1)?.role === "assistant") {
      internals.agent.state.messages = messages.slice(0, -1);
    }
    try {
      await sleep(delayMs, controller.signal);
    } catch {
      internals._retryAttempt = 0;
      internals._emit({
        type: "auto_retry_end",
        success: false,
        attempt,
        finalError: "Retry cancelled",
      });
      return false;
    } finally {
      internals._retryAbortController = undefined;
    }
    return true;
  };
}

/**
 * The retry for a model call that failed transiently (overload, dropped stream, network,
 * timeout, 5xx, 429). It runs inside pi's own retry loop, so tool calls that already ran keep
 * their result; the relay (services/langyagent/adapters/otelrelay/llmretry.go) covers 429s.
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
 * Whether a failed model call is worth another try. A leading status decides first: 408, 429
 * and 5xx are transient, every other 4xx a refusal. Otherwise the wording decides. A plan
 * limit never retries.
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

/** Milliseconds per unit a provider writes after "try again in". */
function unitMs(unit: string): number {
  const lower = unit.toLowerCase();
  if (lower === "ms" || lower.startsWith("milli")) return 1;
  if (lower === "m" || lower.startsWith("min")) return 60_000;
  return 1_000;
}

const DURATION_PART =
  /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/iy;

/** "2m", "1m30s", "820ms", "20 seconds": the parts written back to back, summed. */
function durationMs(text: string): number | undefined {
  let total = 0;
  let matched = false;
  DURATION_PART.lastIndex = 0;
  for (;;) {
    const part = DURATION_PART.exec(text);
    if (!part?.[1] || !part[2]) break;
    total += Number(part[1]) * unitMs(part[2]);
    matched = true;
    while (DURATION_PART.lastIndex < text.length && text[DURATION_PART.lastIndex] === " ") {
      DURATION_PART.lastIndex++;
    }
  }
  return matched ? total : undefined;
}

/** A Retry-After value: seconds, or an HTTP date read as the time left until it. */
function retryAfterMs(value: string, now: number): number | undefined {
  const seconds = /^\s*(\d+(?:\.\d+)?)(?![\d:/-]|\.\d)/.exec(value);
  if (seconds?.[1]) return Number(seconds[1]) * 1_000;
  const at = Date.parse(value);
  if (Number.isNaN(at) || at <= now) return undefined;
  return at - now;
}

/**
 * The wait a provider names in its message ("Please try again in 20s",
 * "try again in 1m30s", "Retry-After: 3", a Retry-After date), in milliseconds.
 */
export function namedWaitMs(errorMessage: string, now: number = Date.now()): number | undefined {
  const inPhrase = /try again in\s+/i.exec(errorMessage);
  if (inPhrase) {
    const named = durationMs(errorMessage.slice(inPhrase.index + inPhrase[0].length));
    if (named !== undefined) return named;
  }
  const header = /retry[- ]after[":\s]+([^\n"]+)/i.exec(errorMessage);
  if (header?.[1]) return retryAfterMs(header[1], now);
  return undefined;
}

/**
 * The wait before retry number `attempt` (from 1), or null when the provider named one too
 * long to take. A named wait is taken as named; otherwise the backoff doubles from
 * MODEL_RETRY_BASE_DELAY_MS with MODEL_RETRY_JITTER either way.
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

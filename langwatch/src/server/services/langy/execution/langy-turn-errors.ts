/**
 * Langy turn-execution domain errors + the failure classifier (ADR-045/046).
 *
 * A turn can fail in a handful of ways we KNOW the shape of, and one way we
 * don't. The processor throws (or is handed) an error; `classifyLangyTurnError`
 * turns it into the platform `SerializedDomainError` shape the browser parses
 * out of the chat stream (`readLangyStreamError` → `explainLangyError`), so the
 * user gets copy that names what actually happened instead of a blanket
 * "something went wrong".
 *
 * Content rule (same as `app-layer/langy/errors.ts`): `meta` carries ONLY what
 * a user or the UI can act on or safely see — an HTTP status, the timeout we
 * gave up at. NEVER the raw manager/opencode message, a stack, a URL, or an
 * internal identifier. The raw detail keeps going to the server log, which is
 * where it belongs.
 *
 * @see src/features/langy/logic/langyErrorExplainer.ts (the copy for each kind)
 * @see services/langyagent/app/app.go (the error frames the manager emits)
 */

import { trace } from "@opentelemetry/api";
import {
  DomainError,
  type SerializedDomainError,
} from "~/server/app-layer/domain-error";

/** How long we give the manager to answer one turn before we give up. */
export const AGENT_CHAT_TIMEOUT_MS = 120_000;

/**
 * The manager could not be reached, or answered with a non-2xx: it is down,
 * mid-deploy, misconfigured, or refusing the turn. `meta.status` is the HTTP
 * status when we got one (a bare status code — safe to show).
 */
export class LangyAgentUnavailableError extends DomainError {
  declare readonly kind: "langy_agent_unavailable";

  constructor(message: string, options: { status?: number } = {}) {
    super("langy_agent_unavailable", message, {
      httpStatus: 503,
      meta: options.status !== undefined ? { status: options.status } : {},
    });
    this.name = "LangyAgentUnavailableError";
  }
}

/**
 * Every Langy worker slot is taken (`ErrMaxWorkers` → the manager's
 * `at-capacity` error frame). Purely transient: retrying later succeeds.
 */
export class LangyAgentAtCapacityError extends DomainError {
  declare readonly kind: "langy_agent_at_capacity";

  constructor() {
    super("langy_agent_at_capacity", "agent reported at-capacity", {
      httpStatus: 429,
    });
    this.name = "LangyAgentAtCapacityError";
  }
}

/**
 * The worker's opencode session vanished mid-turn (`session-not-found`). The
 * manager recycles the worker; the next turn gets a fresh session, so the user
 * only has to send the message again.
 */
export class LangyAgentSessionLostError extends DomainError {
  declare readonly kind: "langy_agent_session_lost";

  constructor() {
    super("langy_agent_session_lost", "agent reported session-not-found", {
      httpStatus: 410,
    });
    this.name = "LangyAgentSessionLostError";
  }
}

/**
 * The agent reached for GitHub — `gh`, or a `git` command that talks to the
 * remote — on a turn whose credentials carry no GitHub token, because the user
 * has never connected their account.
 *
 * NOT a fault, and not a blanket pre-flight: most turns never touch GitHub and
 * must not be stopped. The turn is stopped at the exact moment the agent tries
 * to use a capability it does not have, which the control plane can SEE in the
 * tool stream (`needsGithubAuth`) without asking the model to announce it.
 *
 * The browser renders this as the in-chat Connect card rather than a red error
 * (`render: "suppress"` + a `connect-github` action), and connecting re-drives
 * the turn — so the user never retypes. See
 * `features/langy/logic/langyRecoveryPolicy.ts` (`awaiting-user`).
 */
export class LangyGithubNotConnectedError extends DomainError {
  declare readonly kind: "langy_github_not_connected";

  constructor() {
    super(
      "langy_github_not_connected",
      "agent required GitHub but the account is not connected",
      { httpStatus: 409 },
    );
    this.name = "LangyGithubNotConnectedError";
  }
}

/** The turn blew the `AGENT_CHAT_TIMEOUT_MS` budget (AbortSignal.timeout). */
export class LangyTurnTimeoutError extends DomainError {
  declare readonly kind: "langy_turn_timeout";

  constructor(timeoutMs: number) {
    super("langy_turn_timeout", `agent turn timed out after ${timeoutMs}ms`, {
      httpStatus: 504,
      meta: { timeoutMs },
    });
    this.name = "LangyTurnTimeoutError";
  }
}

/**
 * The worker drained mid-turn (deploy / restart) and terminated the turn. Kept
 * message-identical to the string the drain path used to pass to `failTurn`.
 */
export class LangyWorkerRestartingError extends DomainError {
  declare readonly kind: "langy_worker_restarting";

  constructor() {
    super(
      "langy_worker_restarting",
      "Worker restarting — turn terminated before completion",
      { httpStatus: 503 },
    );
    this.name = "LangyWorkerRestartingError";
  }
}

/**
 * The two error frames the manager emits as a deliberate, typed contract
 * (`app.go`: `sink.ErrorEvent("at-capacity")` / `sink.ErrorEvent("session-not-found")`).
 * Anything else on that frame is `err.Error()` — an arbitrary internal string
 * we must NOT pattern-match on and must NOT show. It becomes a plain `Error`,
 * so the classifier files it under `unknown` (calm copy + trace id) while the
 * raw text still reaches the log via `error.message`.
 */
export function langyAgentErrorFromFrame(frame: string): Error {
  switch (frame.trim().toLowerCase()) {
    case "at-capacity":
      return new LangyAgentAtCapacityError();
    case "session-not-found":
      return new LangyAgentSessionLostError();
    default:
      return new Error(frame);
  }
}

/** Node/undici connect-level failures: the manager isn't answering the socket. */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Walk the `cause` chain (undici wraps the real reason under `TypeError: fetch failed`). */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function isTimeout(error: unknown): boolean {
  return causeChain(error).some((link) => {
    const name = (link as { name?: unknown }).name;
    return name === "TimeoutError" || name === "AbortError";
  });
}

function isUnreachable(error: unknown): boolean {
  return causeChain(error).some((link) => {
    const code = (link as { code?: unknown }).code;
    return typeof code === "string" && UNREACHABLE_CODES.has(code);
  });
}

/** The unhandled shape: no meta, nothing but a trace id to correlate on. */
function unhandledShape(): SerializedDomainError {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return {
    kind: "unknown",
    meta: {},
    telemetry: { traceId: spanContext?.traceId, spanId: spanContext?.spanId },
    httpStatus: 500,
    reasons: [],
  };
}

/**
 * Map a caught turn failure onto the domain-error shape the browser renders.
 * Handled errors keep their `kind`; a genuinely unexpected exception — and only
 * that — falls through to `unknown`.
 */
export function classifyLangyTurnError(error: unknown): SerializedDomainError {
  if (error instanceof DomainError) return error.serialize();
  // fetch/AbortSignal failures arrive as DOMException/TypeError, never as ours.
  if (isTimeout(error)) {
    return new LangyTurnTimeoutError(AGENT_CHAT_TIMEOUT_MS).serialize();
  }
  if (isUnreachable(error)) {
    return new LangyAgentUnavailableError("agent unreachable").serialize();
  }
  return unhandledShape();
}

/**
 * Serialize a turn failure into the JSON the token buffer's `error` entry
 * carries, which `attachTurnStream` re-emits as a structured error PART. The
 * copy the user sees is derived from `kind` in the browser — the raw message
 * never crosses the wire.
 */
export function serializeLangyTurnError(error: unknown): string {
  return JSON.stringify(classifyLangyTurnError(error));
}

/**
 * Langy turn-execution domain errors + the failure classifier (ADR-045/046).
 *
 * A turn can fail in a handful of ways we KNOW the shape of, and one way we
 * don't. The processor throws (or is handed) an error; `classifyLangyTurnError`
 * turns it into the platform `SerializedHandledError` shape the browser parses
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
 * @see app-layer/langyagent/app/app.go (the error frames the manager emits)
 */

import { trace } from "@opentelemetry/api";
import {
  HandledError,
  type SerializedHandledError,
} from "@langwatch/handled-error";
import { remediation } from "../../error-remediation";
import { LangyModelNotConfiguredError } from "~/server/app-layer/langy/errors";

/** How long we give the manager to answer one turn before we give up. */
export const AGENT_CHAT_TIMEOUT_MS = 120_000;

/**
 * The manager could not be reached, or answered with a non-2xx: it is down,
 * mid-deploy, misconfigured, or refusing the turn. `meta.status` is the HTTP
 * status when we got one (a bare status code — safe to show).
 */
export class LangyAgentUnavailableError extends HandledError {
  declare readonly code: "langy_agent_unavailable";

  constructor(message: string, options: { status?: number } = {}) {
    super("langy_agent_unavailable", message, {
      httpStatus: 503,
      fault: "platform",
      ...remediation("langy_agent_unavailable"),
      meta: options.status !== undefined ? { status: options.status } : {},
    });
    this.name = "LangyAgentUnavailableError";
  }
}

/**
 * Every Langy worker slot is taken (`ErrMaxWorkers` → the manager's
 * `at-capacity` error frame). Purely transient: retrying later succeeds.
 */
export class LangyAgentAtCapacityError extends HandledError {
  declare readonly code: "langy_agent_at_capacity";

  constructor() {
    super("langy_agent_at_capacity", "agent reported at-capacity", {
      httpStatus: 429,
      ...remediation("langy_agent_at_capacity"),
    });
    this.name = "LangyAgentAtCapacityError";
  }
}

/**
 * The worker's opencode session vanished mid-turn (`session-not-found`). The
 * manager recycles the worker; the next turn gets a fresh session, so the user
 * only has to send the message again.
 */
export class LangyAgentSessionLostError extends HandledError {
  declare readonly code: "langy_agent_session_lost";

  constructor() {
    super("langy_agent_session_lost", "agent reported session-not-found", {
      httpStatus: 410,
      ...remediation("langy_agent_session_lost"),
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
export class LangyGithubNotConnectedError extends HandledError {
  declare readonly code: "langy_github_not_connected";

  constructor() {
    super(
      "langy_github_not_connected",
      "agent required GitHub but the account is not connected",
      {
        httpStatus: 409,
        ...remediation("langy_github_not_connected"),
      },
    );
    this.name = "LangyGithubNotConnectedError";
  }
}

/**
 * The turn HAD GitHub access, but the repository the agent reached for isn't
 * covered by the organization's GitHub App installation — the clone/push 404'd.
 * The manager's GitHub gate classifies the failed tool call (a 404/not-found on
 * a GitHub-reaching command while a credential was present) and stops the turn
 * with this code instead of letting the model flounder through the failure in
 * prose.
 *
 * Not a fault: the fix is granting the app access to that repository (GitHub's
 * installation settings — Settings → Integrations → Configure deep-links
 * there). Terminal with no auto-retry: the identical request 404s identically
 * until a human changes the installation.
 */
export class LangyGithubRepoNotAccessibleError extends HandledError {
  declare readonly code: "langy_github_repo_not_accessible";

  constructor() {
    super(
      "langy_github_repo_not_accessible",
      "the repository is not available to the LangWatch GitHub App",
      {
        httpStatus: 409,
        ...remediation("langy_github_repo_not_accessible"),
      },
    );
    this.name = "LangyGithubRepoNotAccessibleError";
  }
}

/**
 * The manager could not START a worker for this turn (`worker_spawn_failed`).
 *
 * Distinct from `at-capacity` (there was no free slot) and from `unavailable`
 * (the manager did not answer at all): the manager answered, tried, and the
 * opencode subprocess never came up — a readiness timeout, a failed skill
 * install, a home-directory or egress-guard failure.
 *
 * This is what was landing in `unknown`. The manager emits it as a typed error
 * frame, but `langyAgentErrorFromFrame` only knew two frames, so the third fell
 * through to a bare `Error` and the user got "Something went wrong" plus a trace
 * id — for a failure we can name exactly.
 */
export class LangyWorkerSpawnFailedError extends HandledError {
  declare readonly code: "langy_worker_spawn_failed";

  constructor() {
    super("langy_worker_spawn_failed", "agent reported worker-spawn failure", {
      httpStatus: 503,
      fault: "platform",
      ...remediation("langy_worker_spawn_failed"),
    });
    this.name = "LangyWorkerSpawnFailedError";
  }
}

/**
 * The worker STOPPED before the turn finished, and the control plane has
 * exhausted its own recovery for it. Two roads reach this:
 *
 *   - the manager observed the worker's stream die mid-reply (the opencode
 *     subprocess crashed / was OOM-killed / the pod went away) and emitted a
 *     `worker_stopped` error frame; or
 *   - the liveness subscriber re-dispatched the silent turn across its whole
 *     grace budget and it still never came back, so it terminalized the turn.
 *
 * Either way the browser must NOT auto-retry: the server already tried, and a
 * client re-drive only walks into the same dead worker — which is exactly the
 * flicker (card → silent retry → card, minutes apart) this kind exists to end.
 * It is a FINAL state with a manual "Try again". Nothing was lost — the user's
 * message is on record — so retrying is safe, it is just the user's call to make.
 */
export class LangyWorkerStoppedError extends HandledError {
  declare readonly code: "langy_worker_stopped";

  constructor() {
    super("langy_worker_stopped", "worker stopped before finishing the turn", {
      httpStatus: 503,
      fault: "platform",
      ...remediation("langy_worker_stopped"),
    });
    this.name = "LangyWorkerStoppedError";
  }
}

/**
 * The agent itself reported the turn failed (`agent_error`): the worker is
 * alive and answered deterministically — typically its LLM call was rejected
 * by the provider or gateway. Distinct from `langy_worker_stopped` (the
 * process died or went silent): nothing crashed, the reply just failed, and
 * saying "the worker stopped" for a provider rejection is dishonest copy.
 * Terminal with a manual retry — the server must NOT re-drive a deterministic
 * failure through the liveness budget. `reasons` carries the received herr
 * chain (e.g. the gateway's typed failure) so the full context persists into
 * `LastError` — herr ⇄ HandledError, one model across every wire.
 */
export class LangyAgentErroredError extends HandledError {
  declare readonly code: "langy_agent_errored";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("langy_agent_errored", "agent reported the turn failed", {
      httpStatus: 502,
      // The agent answered deterministically — typically its LLM call was
      // rejected by the provider or gateway.
      fault: "provider",
      ...remediation("langy_agent_errored"),
      reasons: options.reasons,
    });
    this.name = "LangyAgentErroredError";
  }
}

/** The turn blew the `AGENT_CHAT_TIMEOUT_MS` budget (AbortSignal.timeout). */
export class LangyTurnTimeoutError extends HandledError {
  declare readonly code: "langy_turn_timeout";

  constructor(timeoutMs: number) {
    super("langy_turn_timeout", `agent turn timed out after ${timeoutMs}ms`, {
      httpStatus: 504,
      fault: "platform",
      ...remediation("langy_turn_timeout"),
      meta: { timeoutMs },
    });
    this.name = "LangyTurnTimeoutError";
  }
}

/**
 * The worker drained mid-turn (deploy / restart) and terminated the turn. Kept
 * message-identical to the string the drain path used to pass to `failTurn`.
 */
export class LangyWorkerRestartingError extends HandledError {
  declare readonly code: "langy_worker_restarting";

  constructor() {
    super(
      "langy_worker_restarting",
      "Worker restarting — turn terminated before completion",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("langy_worker_restarting"),
      },
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
/** Walk a HandledError chain (the error + its reasons, depth-first) for a kind. */
function domainErrorChainHas(error: Error, code: string): boolean {
  if (!(error instanceof HandledError)) return false;
  if (error.code === code) return true;
  return error.reasons.some((r) => domainErrorChainHas(r, code));
}

/**
 * Classify the manager's terminal error frame, preferring the typed cause
 * chain when present (the wire's herr envelope, already deserialized into a
 * HandledError by the relay-frame schema — this code never sees the wire
 * dialect): a KNOWN cause anywhere in the chain gets its own kind (so a
 * gateway `no_provider_configured` renders the model-setup card, not a
 * generic failure), and the generic `agent_error` keeps the received chain as
 * reasons so the full context persists into `LastError`. Falls back to the
 * bare-code mapping for frames without a cause.
 */
export function langyAgentErrorFromErrorFrame({
  code,
  cause,
}: {
  code?: string;
  cause?: HandledError;
}): Error {
  if (cause) {
    const reasons = [...cause.reasons];
    // The organization has no model provider configured — an unmet setup
    // step, not a fault. Same state the turn-START guard names, so the same
    // kind (and the same "configure a model" card).
    if (domainErrorChainHas(cause, "no_provider_configured")) {
      return new LangyModelNotConfiguredError({ reasons });
    }
    if (cause.code === "agent_error") {
      return new LangyAgentErroredError({ reasons });
    }
  }
  return langyAgentErrorFromFrame(code ?? cause?.code ?? "agent error");
}

export function langyAgentErrorFromFrame(frame: string): Error {
  const normalized = frame.trim().toLowerCase();
  switch (normalized) {
    case "at-capacity":
      return new LangyAgentAtCapacityError();
    // Both spellings of the session-vanished code: the classifier historically
    // matched the hyphenated form, but the mono-binary emits the snake_case
    // `session_not_found` on its error frame (see app.go). Accept either.
    case "session-not-found":
    case "session_not_found":
      return new LangyAgentSessionLostError();
    // The worker stopped mid-turn. `worker_stopped` is the deliberate signal;
    // `post_error` (the worker would not accept the prompt) is the older code
    // for the same thing — the opencode process died or is broken.
    case "worker_stopped":
    case "post_error":
      return new LangyWorkerStoppedError();
    // The agent reported its own failure (e.g. the provider rejected its LLM
    // call). The worker is fine; the reply failed. Its own kind, so the copy
    // never claims a crash that didn't happen.
    case "agent_error":
      return new LangyAgentErroredError();
    // The manager's GitHub gate (services/langyagent/app/githubgate.go) stopped
    // the turn: the agent reached for GitHub without the access this turn
    // carried. Not connected ⇒ the install card (render: suppress); repo not
    // accessible ⇒ the "grant the app access" card. These are the ONLY
    // producers of the two codes the client's connect-card flow is keyed to.
    case "langy_github_not_connected":
      return new LangyGithubNotConnectedError();
    case "langy_github_repo_not_accessible":
      return new LangyGithubRepoNotAccessibleError();
  }
  // The manager also surfaces its typed `herr` CODES on this frame, e.g.
  // `worker_spawn_failed (map[message:...])`. Match on the code prefix, not the
  // whole string: the parenthesised detail is the manager's internal envelope and
  // is neither stable nor safe to show. Anything still unmatched stays a bare
  // Error — it becomes `unknown`, and its raw text reaches the log only.
  if (normalized.startsWith("worker_spawn_failed")) {
    return new LangyWorkerSpawnFailedError();
  }
  return new Error(frame);
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

/**
 * The unhandled shape: nothing but an id to correlate on.
 *
 * The id must IDENTIFY THE INCIDENT. It used to be the ACTIVE TRACE id, which in
 * the worker is the long-lived process/turn-processor span — so every failure,
 * in every conversation, showed the user the SAME id. An id that does not
 * identify the thing it is attached to is worse than no id: it sends whoever
 * receives it looking for the wrong incident. The SPAN id is per-failure, so we
 * lead with it and keep the trace id only as a correlation hint.
 */
function unhandledShape(): SerializedHandledError {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return {
    code: "unknown",
    // Deprecated back-compat alias of `code` — see SerializedHandledError.kind.
    kind: "unknown",
    meta: {},
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
    httpStatus: 500,
    // An unclassified failure is potentially ours — log it like an incident.
    fault: "platform",
    reasons: [],
  };
}

/**
 * Map a caught turn failure onto the domain-error shape the browser renders.
 * Handled errors keep their `kind`; a genuinely unexpected exception — and only
 * that — falls through to `unknown`.
 */
export function classifyLangyTurnError(error: unknown): SerializedHandledError {
  if (error instanceof HandledError) return error.serialize();
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

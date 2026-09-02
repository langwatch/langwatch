import { HandledError, NotFoundError, remediationFor } from "@langwatch/handled-error";

import { remediation } from "./langy.error-remediation";

/**
 * Langy conversation domain errors (ADR-046).
 *
 * These use the platform `HandledError` framework so they carry a serialisable
 * `kind` discriminant, renderable `meta`, an `httpStatus`, and OTel telemetry.
 * `kind` is cross-process- and cross-language-safe: a handled error raised in
 * the Go worker can proxy across the boundary as the same `kind`, and the
 * frontend renders a tailored experience by matching on it (never by parsing a
 * message string). Unhandled infrastructure errors stay opaque — surfaced as a
 * generic message and logged — via `HandledError.isUnhandled` / `toUserMessage`.
 *
 * Content rule: `message` and `meta` may hold ONLY what a user, an AI agent, or
 * the UI can act on — something to fix the problem or render a better
 * experience (here: the `conversationId` the caller already holds). Never put
 * internal or private detail, query internals, or over-engineered payloads on a
 * domain error — that belongs in server logs, not on the wire.
 *
 * `tips` mirror the client-side explainer copy
 * (`features/langy/logic/langyErrorExplainer.ts`) so API/CLI/MCP consumers get
 * the same remediation the UI renders.
 */

/**
 * Langy is not rolled out to this account (HTTP 404). `release_langy_enabled`
 * (langyAccessGate) is the only lever — there is no staff bypass. A denied
 * caller gets NOT_FOUND, never FORBIDDEN, so the gate cannot double as a probe
 * for whether Langy exists for the account.
 *
 * It is a typed handled error (kind `langy_not_enabled`), NOT a bare tRPC
 * NOT_FOUND: a bare code carries no kind, so the panel could only fall back to a
 * generic "conversations aren't loading, try again" — wrong for a rollout gate,
 * which no retry fixes. With a kind the client can render a real "not enabled"
 * state and tell a gate apart from a transient load failure.
 */
export class LangyNotEnabledError extends HandledError {
  declare readonly code: "langy_not_enabled";

  constructor() {
    super("langy_not_enabled", "Langy is not currently enabled for this account.", {
      httpStatus: 404,
    });
    this.name = "LangyNotEnabledError";
  }
}

/** The requested conversation does not exist, or has been archived (HTTP 404). */
export class LangyConversationNotFoundError extends NotFoundError {
  declare readonly code: "langy_conversation_not_found";

  constructor(conversationId: string, options: { reasons?: readonly Error[] } = {}) {
    super("langy_conversation_not_found", "Langy conversation", conversationId, {
      meta: { conversationId },
      ...remediation("langy_conversation_not_found"),
      ...options,
    });
    this.name = "LangyConversationNotFoundError";
  }
}

/**
 * A conversationId that belongs to a different user was passed for continuation
 * (HTTP 403). Distinct from not-found so the UI can explain the ownership
 * boundary rather than offering to start fresh.
 */
export class LangyConversationNotOwnedError extends HandledError {
  declare readonly code: "langy_conversation_not_owned";

  constructor(public readonly conversationId: string) {
    super("langy_conversation_not_owned", "This conversation belongs to another user.", {
      meta: { conversationId },
      httpStatus: 403,
      ...remediation("langy_conversation_not_owned"),
    });
    this.name = "LangyConversationNotOwnedError";
  }
}

/**
 * A caller opted into conversation-id ADOPTION (`adoptConversationId: true`)
 * with an id that cannot be adopted: it fails the shape gate, or it collides
 * with an archived conversation whose closed history must not be silently
 * resurrected (HTTP 409).
 *
 * Loud on purpose. Adoption exists for callers that key continuity on an
 * externally-chosen id (scenario runs bind `{{ threadId }}` once per run); the
 * pre-adoption behavior — silently minting a fresh id — degraded every
 * multi-turn run to single-turn with no signal anywhere (#7187). An adoption
 * that cannot happen must therefore fail the turn, never fall back.
 */
export class LangyConversationIdUnadoptableError extends HandledError {
  declare readonly code: "langy_conversation_id_unadoptable";

  constructor(
    public readonly conversationId: string,
    reason: "invalid_shape" | "archived",
  ) {
    super(
      "langy_conversation_id_unadoptable",
      reason === "archived"
        ? "This conversation id belongs to an archived conversation and cannot be adopted."
        : "This conversation id cannot be adopted: use 6-120 characters from [A-Za-z0-9_-].",
      {
        meta: { conversationId, reason },
        httpStatus: 409,
        ...remediation("langy_conversation_id_unadoptable"),
      },
    );
    this.name = "LangyConversationIdUnadoptableError";
  }
}

/** No model is configured for the project's Langy (HTTP 409). */
export class LangyModelNotConfiguredError extends HandledError {
  declare readonly code: "langy_model_not_configured";
  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("langy_model_not_configured", "No model configured for this project.", {
      httpStatus: 409,
      ...remediation("langy_model_not_configured"),
      reasons: options.reasons,
    });
    this.name = "LangyModelNotConfiguredError";
  }
}

/**
 * A model Langy may not run for this project (HTTP 400): it is not on the
 * project's Langy allowlist. The allowlist is the ONLY runnable-set gate —
 * the engine itself is provider-blind, dispatching whatever model it is
 * given with its full provider-prefixed id and letting the AI gateway's
 * prefix routing pick the provider.
 */
export class LangyModelNotAllowedError extends HandledError {
  declare readonly code: "langy_model_not_allowed";
  constructor(public readonly model: string) {
    super(
      "langy_model_not_allowed",
      `Model "${model}" is not allowed for this project's Langy. Pick from the configured models.`,
      {
        meta: { model },
        httpStatus: 400,
        ...remediation("langy_model_not_allowed"),
      },
    );
    this.name = "LangyModelNotAllowedError";
  }
}

/** The project's Langy egress allow-list is misconfigured; fail closed (HTTP 409). */
export class LangyEgressMisconfiguredError extends HandledError {
  declare readonly code: "langy_egress_misconfigured";
  constructor() {
    super(
      "langy_egress_misconfigured",
      "Langy egress policy is misconfigured for this project.",
      {
        httpStatus: 409,
        ...remediation("langy_egress_misconfigured"),
      },
    );
    this.name = "LangyEgressMisconfiguredError";
  }
}

/** The caller holds none of Langy's permissions in this project (HTTP 409). */
export class LangyInsufficientScopeError extends HandledError {
  declare readonly code: "langy_insufficient_scope";
  constructor(message: string) {
    super("langy_insufficient_scope", message, {
      httpStatus: 409,
      ...remediation("langy_insufficient_scope"),
    });
    this.name = "LangyInsufficientScopeError";
  }
}

/**
 * The same idempotency key arrived with different content (HTTP 409). A retry
 * must replay the SAME send byte-for-byte; a new send mints a new key. Turn
 * identity is a hash of who+key+content, so this is detected structurally —
 * the derived turn id no longer matches the admitted one.
 */
export class LangyIdempotencyMismatchError extends HandledError {
  declare readonly code: "langy_idempotency_mismatch";
  constructor() {
    super(
      "langy_idempotency_mismatch",
      "This idempotency key was already used for a different message.",
      {
        httpStatus: 409,
        ...remediation("langy_idempotency_mismatch"),
      },
    );
    this.name = "LangyIdempotencyMismatchError";
  }
}

/**
 * The send carried no usable text (HTTP 422). Accepting it would admit a turn
 * the agent can only reject — and a permanently rejected dispatch used to
 * poison the process outbox with endless retries.
 */
export class LangyEmptyMessageError extends HandledError {
  declare readonly code: "langy_empty_message";
  constructor() {
    super("langy_empty_message", "The message has no text content.", {
      httpStatus: 422,
      ...remediation("langy_empty_message"),
    });
    this.name = "LangyEmptyMessageError";
  }
}

/**
 * The caller is sending faster than the per-user Langy limit allows (HTTP 429).
 *
 * `meta.message` carries the sentence deliberately: `serialize()` does not put a
 * HandledError's `message` on the wire, so per ADR-045 `meta.message` is the one
 * channel that reaches a client with no bespoke explainer case for the code.
 */
export class LangyRateLimitedError extends HandledError {
  declare readonly code: "langy_rate_limited";
  constructor(message = "Too many messages. Please slow down.") {
    super("langy_rate_limited", message, {
      httpStatus: 429,
      fault: "customer",
      meta: { message },
      ...remediation("langy_rate_limited"),
    });
    this.name = "LangyRateLimitedError";
  }
}

/** A turn is already in flight for the conversation — one at a time (HTTP 409). */
export class LangyTurnInProgressError extends HandledError {
  declare readonly code: "langy_turn_in_progress";
  constructor() {
    super(
      "langy_turn_in_progress",
      "A response is already in progress for this conversation.",
      {
        httpStatus: 409,
        ...remediation("langy_turn_in_progress"),
      },
    );
    this.name = "LangyTurnInProgressError";
  }
}

/**
 * The stop names a turn this conversation does not have in flight (HTTP 409).
 *
 * A stop is the one client-supplied turn id that gets to write a DURABLE
 * terminal, so it may not be taken on trust. The turn's own actor is proven by
 * the live-access grant and needs nothing further; anyone else stopping a turn
 * — a second tab, a rejoin after a refresh — has to name the turn the record
 * actually has in flight, or the conversation's owner could terminate (and
 * fabricate an assistant message on) an arbitrary turn id.
 *
 * Distinct from a stop that merely arrived late: that turn IS the one in
 * flight until its terminal lands, and the terminal slot collapses the loser.
 */
export class LangyTurnNotStoppableError extends HandledError {
  declare readonly code: "langy_turn_not_stoppable";
  constructor(turnId: string) {
    super(
      "langy_turn_not_stoppable",
      "That turn is not the one in progress on this conversation.",
      {
        httpStatus: 409,
        meta: { turnId },
        ...remediation("langy_turn_not_stoppable"),
      },
    );
    this.name = "LangyTurnNotStoppableError";
  }
}

/**
 * The agent answered a dispatch with a permanent 4xx: the request itself is
 * invalid and no retry can change that. Terminal for the turn — the poison
 * alternative was an outbox retrying the same rejection forever.
 */
export class LangyDispatchRejectedError extends HandledError {
  declare readonly code: "langy_dispatch_rejected";
  constructor() {
    super(
      "langy_dispatch_rejected",
      "The agent rejected this turn's request as invalid.",
      {
        httpStatus: 422,
        ...remediation("langy_dispatch_rejected"),
      },
    );
    this.name = "LangyDispatchRejectedError";
  }
}

/** The agent/transport is temporarily unavailable (HTTP 503). */
export class LangyAgentUnavailableError extends HandledError {
  declare readonly code: "langy_agent_unavailable";
  constructor(message = "Agent is temporarily unavailable. Please try again shortly.") {
    super("langy_agent_unavailable", message, {
      httpStatus: 503,
      fault: "platform",
      ...remediation("langy_agent_unavailable"),
    });
    this.name = "LangyAgentUnavailableError";
  }
}

// ── the key-authed public turn surface (`/api/langy`) ─────────────────────
//
// Transport refusals, not domain rules: they say why a REQUEST could not be
// admitted, before any conversation exists to have a rule about. They live
// here rather than in the route so the route throws and never serialises —
// `createServiceApp`'s canonical envelope owns the wire shape (ADR-045).
//
// The flag-off refusal is deliberately absent from this list. A dark surface
// answers the platform's generic `not_found`, because a Langy-specific code
// would tell an unauthorised caller the surface exists.

/** No credential presented at all. */
export class LangyApiCredentialMissingError extends HandledError {
  declare readonly code: "langy_api_credential_missing";
  constructor() {
    super("langy_api_credential_missing", "Authentication token is required.", {
      httpStatus: 401,
      ...remediation("langy_api_credential_missing"),
    });
    this.name = "LangyApiCredentialMissingError";
  }
}

/** A credential was presented but resolved to no project. */
export class LangyApiCredentialInvalidError extends HandledError {
  declare readonly code: "langy_api_credential_invalid";
  constructor() {
    super("langy_api_credential_invalid", "Invalid auth token.", {
      httpStatus: 401,
      ...remediation("langy_api_credential_invalid"),
    });
    this.name = "LangyApiCredentialInvalidError";
  }
}

/**
 * The key authenticates but cannot be bridged to a user to act as.
 *
 * One class, three codes: the caller branches on the code, and the three cases
 * need genuinely different remediation (mint a personal key / ask an admin for
 * Langy access / the owner is gone). Splitting them into three classes would
 * duplicate the body for no caller-visible gain.
 */
export class LangyApiIdentityDeniedError extends HandledError {
  declare readonly code:
    | "langy_api_key_unowned"
    | "langy_api_key_no_langy_access"
    | "langy_api_actor_missing";
  constructor(
    code:
      | "langy_api_key_unowned"
      | "langy_api_key_no_langy_access"
      | "langy_api_actor_missing",
    message: string,
  ) {
    super(code, message, {
      httpStatus: 403,
      ...remediation(code),
    });
    this.name = "LangyApiIdentityDeniedError";
  }
}

/** The body did not parse against the turn schema. */
export class LangyApiRequestInvalidError extends HandledError {
  declare readonly code: "langy_api_request_invalid";
  constructor(issues: readonly unknown[]) {
    super("langy_api_request_invalid", "Invalid request body.", {
      httpStatus: 400,
      meta: { issues },
      ...remediation("langy_api_request_invalid"),
    });
    this.name = "LangyApiRequestInvalidError";
  }
}

/**
 * UI-action channel errors (specs/langy/langy-ui-actions.feature).
 *
 * Every refusal on the dispatch path is a handled error with a stable code,
 * because the primary reader is the AGENT: the CLI prints the envelope to
 * stderr and the model adapts its next step to the `code`. Only
 * `langy_ui_timeout` and `langy_ui_handler_failed` also reach a human (as a
 * toast on the page that tried to execute), so only those two carry
 * presentation copy beyond the registry defaults.
 */

/** The conversation has no turn in flight, so no page is listening (HTTP 409). */
export class LangyUiTurnInactiveError extends HandledError {
  declare readonly code: "langy_ui_turn_inactive";
  constructor() {
    super(
      "langy_ui_turn_inactive",
      "No agent turn is active for this conversation, so there is no live page to drive.",
      {
        httpStatus: 409,
        ...remediation("langy_ui_turn_inactive"),
      },
    );
    this.name = "LangyUiTurnInactiveError";
  }
}

/** `kind` names no entry in any page's action manifest (HTTP 400). */
export class LangyUiActionUnknownError extends HandledError {
  declare readonly code: "langy_ui_action_unknown";
  constructor(kind: string) {
    super("langy_ui_action_unknown", `Unknown UI action "${kind}".`, {
      httpStatus: 400,
      fault: "customer",
      meta: { kind },
      ...remediation("langy_ui_action_unknown"),
    });
    this.name = "LangyUiActionUnknownError";
  }
}

/** The payload failed the action's schema (HTTP 400). `meta.issues` names the fields. */
export class LangyUiPayloadInvalidError extends HandledError {
  declare readonly code: "langy_ui_payload_invalid";
  constructor(kind: string, issues: readonly unknown[]) {
    super(
      "langy_ui_payload_invalid",
      `The payload for "${kind}" does not match the action's schema.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { kind, issues: issues.slice(0, 10) },
        ...remediation("langy_ui_payload_invalid"),
      },
    );
    this.name = "LangyUiPayloadInvalidError";
  }
}

/**
 * Nothing claimed the action within the claim window and the action has no
 * backend fallback (HTTP 409). Phase 3 turns most of these into a transparent
 * backend execution; this refusal remains for kinds only a live page can run.
 */
export class LangyUiNoBrowserError extends HandledError {
  declare readonly code: "langy_ui_no_browser";
  constructor(kind: string) {
    super("langy_ui_no_browser", `No open page claimed "${kind}" in time.`, {
      httpStatus: 409,
      meta: { kind },
      ...remediation("langy_ui_no_browser"),
    });
    this.name = "LangyUiNoBrowserError";
  }
}

/**
 * A page claimed the action and never reported a result inside the action's
 * execute budget (HTTP 504). The page may still have half-applied it, so the
 * caller must re-read state before retrying rather than firing again blind.
 */
export class LangyUiTimeoutError extends HandledError {
  declare readonly code: "langy_ui_timeout";
  constructor(kind: string) {
    super(
      "langy_ui_timeout",
      `The page claimed "${kind}" but did not finish inside the action's time budget.`,
      {
        httpStatus: 504,
        fault: "platform",
        meta: { kind },
        ...remediation("langy_ui_timeout"),
      },
    );
    this.name = "LangyUiTimeoutError";
  }
}

/**
 * The action must run on the backend (no page answered) and the dispatch named
 * no experiment to run it against (HTTP 400). The browser path never needs
 * this: the open page IS the experiment. The CLI passes `--experiment <slug>`.
 */
export class LangyUiExperimentRequiredError extends HandledError {
  declare readonly code: "langy_ui_experiment_required";
  constructor(kind: string) {
    super(
      "langy_ui_experiment_required",
      `No open page answered, and running "${kind}" on the backend needs the experiment named.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { kind },
        ...remediation("langy_ui_experiment_required"),
      },
    );
    this.name = "LangyUiExperimentRequiredError";
  }
}

/**
 * The generic code the browser reports when a handler threw something that
 * named no code of its own.
 */
const UNTYPED_HANDLER_FAILURE = "langy_ui_handler_failed";

/**
 * The action ran on the page or on the backend and failed there (HTTP 502).
 *
 * The fault follows `errorCode`: a code names the handler's own typed refusal
 * (a transform's `target_not_found`, an experiment with no saved state), which
 * the agent asked for and can act on, so the caller is at fault. No code, or
 * the generic one the browser sends for a throw that named none, is a failure
 * we cannot explain, so it stays a platform fault and keeps alerting. The
 * status stays 502 either way: the page is the upstream that did not carry the
 * action out, and `fault` is the axis log level and alerts read.
 */
export class LangyUiHandlerFailedError extends HandledError {
  declare readonly code: "langy_ui_handler_failed";
  constructor(kind: string, errorCode?: string) {
    super(
      "langy_ui_handler_failed",
      `The page could not carry out "${kind}".`,
      {
        httpStatus: 502,
        fault:
          errorCode && errorCode !== UNTYPED_HANDLER_FAILURE
            ? "customer"
            : "platform",
        meta: { kind, ...(errorCode ? { errorCode } : {}) },
        // The page's own code first when it has advice of its own: the generic
        // tip only says to read `meta.errorCode`, which is a name, not a next
        // step.
        ...{
          ...remediation("langy_ui_handler_failed"),
          ...remediationFor(errorCode),
        },
      },
    );
    this.name = "LangyUiHandlerFailedError";
  }
}

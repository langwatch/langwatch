import { HandledError, NotFoundError } from "@langwatch/handled-error";

import { remediation } from "../error-remediation";

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

/** The requested conversation does not exist, or has been archived (HTTP 404). */
export class LangyConversationNotFoundError extends NotFoundError {
  declare readonly code: "langy_conversation_not_found";

  constructor(
    conversationId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
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
    super(
      "langy_conversation_not_owned",
      "This conversation belongs to another user.",
      {
        meta: { conversationId },
        httpStatus: 403,
        ...remediation("langy_conversation_not_owned"),
      },
    );
    this.name = "LangyConversationNotOwnedError";
  }
}

/** No model is configured for the project's Langy (HTTP 409). */
export class LangyModelNotConfiguredError extends HandledError {
  declare readonly code: "langy_model_not_configured";
  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "langy_model_not_configured",
      "No model configured for this project.",
      {
        httpStatus: 409,
        ...remediation("langy_model_not_configured"),
        reasons: options.reasons,
      },
    );
    this.name = "LangyModelNotConfiguredError";
  }
}

/** A `modelOverride` not on the project's Langy VK allowlist (HTTP 400). */
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
  constructor(
    message = "Agent is temporarily unavailable. Please try again shortly.",
  ) {
    super("langy_agent_unavailable", message, {
      httpStatus: 503,
      fault: "platform",
      ...remediation("langy_agent_unavailable"),
    });
    this.name = "LangyAgentUnavailableError";
  }
}

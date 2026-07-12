import { DomainError, NotFoundError } from "~/server/app-layer/domain-error";

/**
 * Langy conversation domain errors (ADR-046).
 *
 * These use the platform `DomainError` framework so they carry a serialisable
 * `kind` discriminant, renderable `meta`, an `httpStatus`, and OTel telemetry.
 * `kind` is cross-process- and cross-language-safe: a handled error raised in
 * the Go worker can proxy across the boundary as the same `kind`, and the
 * frontend renders a tailored experience by matching on it (never by parsing a
 * message string). Unhandled infrastructure errors stay opaque — surfaced as a
 * generic message and logged — via `DomainError.isUnhandled` / `toUserMessage`.
 *
 * Content rule: `message` and `meta` may hold ONLY what a user, an AI agent, or
 * the UI can act on — something to fix the problem or render a better
 * experience (here: the `conversationId` the caller already holds). Never put
 * internal or private detail, query internals, or over-engineered payloads on a
 * domain error — that belongs in server logs, not on the wire.
 */

/** The requested conversation does not exist, or has been archived (HTTP 404). */
export class LangyConversationNotFoundError extends NotFoundError {
  declare readonly kind: "langy_conversation_not_found";

  constructor(
    conversationId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("langy_conversation_not_found", "Langy conversation", conversationId, {
      meta: { conversationId },
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
export class LangyConversationNotOwnedError extends DomainError {
  declare readonly kind: "langy_conversation_not_owned";

  constructor(public readonly conversationId: string) {
    super(
      "langy_conversation_not_owned",
      "This conversation belongs to another user.",
      { meta: { conversationId }, httpStatus: 403 },
    );
    this.name = "LangyConversationNotOwnedError";
  }
}

/** No model is configured for the project's Langy (HTTP 409). */
export class LangyModelNotConfiguredError extends DomainError {
  declare readonly kind: "langy_model_not_configured";
  constructor() {
    super(
      "langy_model_not_configured",
      "No model configured for this project.",
      { httpStatus: 409 },
    );
    this.name = "LangyModelNotConfiguredError";
  }
}

/** A `modelOverride` not on the project's Langy VK allowlist (HTTP 400). */
export class LangyModelNotAllowedError extends DomainError {
  declare readonly kind: "langy_model_not_allowed";
  constructor(public readonly model: string) {
    super(
      "langy_model_not_allowed",
      `Model "${model}" is not allowed for this project's Langy. Pick from the configured models.`,
      { meta: { model }, httpStatus: 400 },
    );
    this.name = "LangyModelNotAllowedError";
  }
}

/** The project's Langy egress allow-list is misconfigured; fail closed (HTTP 409). */
export class LangyEgressMisconfiguredError extends DomainError {
  declare readonly kind: "langy_egress_misconfigured";
  constructor() {
    super(
      "langy_egress_misconfigured",
      "Langy egress policy is misconfigured for this project.",
      { httpStatus: 409 },
    );
    this.name = "LangyEgressMisconfiguredError";
  }
}

/** The caller holds none of Langy's permissions in this project (HTTP 409). */
export class LangyInsufficientScopeError extends DomainError {
  declare readonly kind: "langy_insufficient_scope";
  constructor(message: string) {
    super("langy_insufficient_scope", message, { httpStatus: 409 });
    this.name = "LangyInsufficientScopeError";
  }
}

/** A turn is already in flight for the conversation — one at a time (HTTP 409). */
export class LangyTurnInProgressError extends DomainError {
  declare readonly kind: "langy_turn_in_progress";
  constructor() {
    super(
      "langy_turn_in_progress",
      "A response is already in progress for this conversation.",
      { httpStatus: 409 },
    );
    this.name = "LangyTurnInProgressError";
  }
}

/** The agent/transport is temporarily unavailable (HTTP 503). */
export class LangyAgentUnavailableError extends DomainError {
  declare readonly kind: "langy_agent_unavailable";
  constructor(
    message = "Agent is temporarily unavailable. Please try again shortly.",
  ) {
    super("langy_agent_unavailable", message, { httpStatus: 503 });
    this.name = "LangyAgentUnavailableError";
  }
}

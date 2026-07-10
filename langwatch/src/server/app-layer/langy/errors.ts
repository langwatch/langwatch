import { DomainError, NotFoundError } from "~/server/app-layer/domain-error";

/**
 * Langy conversation domain errors (ADR-043).
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

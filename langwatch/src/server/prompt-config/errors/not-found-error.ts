import { HandledError } from "@langwatch/handled-error";

/**
 * Thrown when a prompt config (or one of its versions) does not exist in the
 * project. HTTP 404.
 *
 * A `HandledError` with the enumerated `prompt_not_found` code: a missing
 * prompt is a knowable failure on a core surface, so every consumer gets a
 * stable code rather than prose. `createServiceApp`'s `onError` serialises it
 * for REST/CLI/MCP callers, the tRPC boundary puts the code on the wire, and
 * the client takes its words from the presentation registry — no route needs
 * to hand-roll a 404 body or re-wrap it as a `TRPCError`.
 *
 * `message` stays a sentence naming the id for the log line. It is
 * customer-safe (an id the caller just supplied) and never the UI copy.
 */
export class NotFoundError extends HandledError {
  declare readonly code: "prompt_not_found";

  constructor(message: string) {
    super("prompt_not_found", message, { httpStatus: 404 });
    this.name = "NotFoundError";
  }
}

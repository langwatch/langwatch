import { DomainError } from "~/server/app-layer/domain-error";

/**
 * Thrown when neither a top-level `prompt` nor a system message in
 * `messages` is supplied to a prompt create / update. Distinct from
 * [[SystemPromptConflictError]] (both supplied), which is 409 Conflict.
 *
 * HTTP 400 Bad Request — the message is user-facing and surfaced verbatim
 * via the toast in the UI.
 */
export class SystemPromptRequiredError extends DomainError {
  constructor(message?: string) {
    super("system_prompt_required", message ?? "System prompt is required.", {
      httpStatus: 400,
    });
    this.name = "SystemPromptRequiredError";
  }
}

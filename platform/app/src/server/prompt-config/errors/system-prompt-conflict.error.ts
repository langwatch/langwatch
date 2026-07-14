import { DomainError } from "~/server/app-layer/domain-error";

/**
 * Thrown when a caller supplies BOTH a top-level `prompt` field AND a system
 * message inside `messages` — the two are mutually exclusive (the system
 * message is normalised into `prompt`). HTTP 409 Conflict.
 *
 * For the distinct "neither prompt nor system message was supplied" case
 * (HTTP 400 Bad Request), use [[SystemPromptRequiredError]].
 */
export class SystemPromptConflictError extends DomainError {
  constructor(message?: string) {
    super(
      "system_prompt_conflict",
      message ?? "System prompt and prompt cannot be set at the same time",
      { httpStatus: 409 },
    );
    this.name = "SystemPromptConflictError";
  }
}

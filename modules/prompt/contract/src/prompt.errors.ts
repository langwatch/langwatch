import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

export const promptProblemSchema = z
  .object({ code: z.string(), message: z.string(), details: z.unknown().optional() })
  .strict();
export type PromptProblem = z.infer<typeof promptProblemSchema>;

export class PromptNotFoundError extends HandledError {
  declare readonly code: "prompt_not_found";

  constructor(message = "Prompt not found") {
    super("prompt_not_found", message, {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "PromptNotFoundError";
  }
}
export class PromptTagNotFoundError extends Error {
  readonly code = "prompt_tag_not_found";
  constructor(public readonly tagName: string) {
    super(`Tag "${tagName}" not found.`);
    this.name = "PromptTagNotFoundError";
  }
}
export class PromptTagValidationError extends Error {
  readonly code = "prompt_tag_invalid";
  constructor(message: string) {
    super(message);
    this.name = "PromptTagValidationError";
  }
}
export class PromptTagConflictError extends Error {
  readonly code = "prompt_tag_conflict";
  constructor(message: string) {
    super(message);
    this.name = "PromptTagConflictError";
  }
}
export class PromptTagProtectedError extends Error {
  readonly code = "prompt_tag_protected";
  constructor(
    public readonly tagName: string,
    action: "deleted" | "renamed" = "deleted",
  ) {
    super(`"${tagName}" is a protected tag and cannot be ${action}.`);
    this.name = "PromptTagProtectedError";
  }
}
/**
 * The handle this write asked for is already in use at the scope it was asked
 * for. Raised by persistence, where the uniqueness actually lives; the door
 * that took the write names the scope in the message a caller reads.
 */
export class PromptHandleTakenError extends HandledError {
  declare readonly code: "prompt_handle_taken";

  constructor(message = "Prompt handle already exists") {
    super("prompt_handle_taken", message, {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "PromptHandleTakenError";
  }
}
export class PromptHandleGenerationError extends Error {
  readonly code = "prompt_handle_generation_failed";
  constructor(message: string) {
    super(message);
    this.name = "PromptHandleGenerationError";
  }
}
export class PromptSystemPromptConflictError extends HandledError {
  declare readonly code: "prompt_system_prompt_conflict";

  constructor(message = "System prompt and prompt cannot be set at the same time") {
    super("prompt_system_prompt_conflict", message, {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "PromptSystemPromptConflictError";
  }
}

export class PromptSystemPromptRequiredError extends HandledError {
  declare readonly code: "prompt_system_prompt_required";

  constructor(message = "Prompt or system message is required.") {
    super("prompt_system_prompt_required", message, {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptSystemPromptRequiredError";
  }
}
/**
 * The playground door was reached without a signed-in browser session. The
 * door reads the session itself, so the refusal is its own rather than the
 * framework's.
 */
export class PromptPlaygroundSignInRequiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "Sign in to run a prompt in the playground", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "PromptPlaygroundSignInRequiredError";
  }
}

/**
 * The session is real and does not hold `prompts:view` on the project it
 * named — or the project is the shared demo, which never spends provider
 * credit on a visitor's run.
 */
export class PromptPlaygroundNotPermittedError extends HandledError {
  declare readonly code: "insufficient_permissions";

  constructor() {
    super("insufficient_permissions", "You cannot run prompts on this project", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "PromptPlaygroundNotPermittedError";
  }
}

export class HandleGenerationError extends Error {
  readonly code = "prompt_handle_generation_failed";
  constructor(message: string) {
    super(message);
    this.name = "HandleGenerationError";
  }
}
export { PromptNotFoundError as NotFoundError };
export {
  PromptSystemPromptConflictError as SystemPromptConflictError,
  PromptSystemPromptRequiredError as SystemPromptRequiredError,
};

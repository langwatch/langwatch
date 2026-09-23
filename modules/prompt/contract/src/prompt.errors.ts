import { HandledError, NotFoundError } from "@langwatch/handled-error";
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
/**
 * The prompt was never copied from anywhere, so there is nothing to sync from.
 * Raised by persistence, where the copy link actually lives.
 */
export class PromptNotACopyError extends HandledError {
  declare readonly code: "prompt_not_a_copy";

  constructor() {
    super("prompt_not_a_copy", "This prompt is not a copy and has no source to sync from", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptNotACopyError";
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
/**
 * A version number this prompt already has. Raised by persistence, where the uniqueness on
 * (configId, version) actually lives — a raw constraint error reached the boundary as an
 * unattributed 500, where a restore owes the caller a conflict it can act on.
 */
export class PromptVersionConflictError extends HandledError {
  declare readonly code: "prompt_version_conflict";

  constructor() {
    super("prompt_version_conflict", "That prompt version already exists", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "PromptVersionConflictError";
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
 * The playground door answered this project one run too many inside the
 * window. `fault` stays customer: it is their run rate, and the retry-after
 * is theirs to wait out.
 */
export class PromptExecuteRateLimitedError extends HandledError {
  declare readonly code: "prompt_execute_rate_limited";

  constructor(input: { retryAfterSeconds?: number | undefined }) {
    super("prompt_execute_rate_limited", "Too many playground runs for this project", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
      ...(input.retryAfterSeconds !== undefined
        ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
        : {}),
    });
    this.name = "PromptExecuteRateLimitedError";
  }
}

/**
 * A message array above the plan's bound. Refused rather than truncated: a
 * caller must learn the bound on the first oversized run, not discover
 * dropped messages in a bill later.
 */
export class PromptMessagesTooManyError extends HandledError {
  declare readonly code: "prompt_messages_too_many";

  constructor(maxMessages: number) {
    super(
      "prompt_messages_too_many",
      `At most ${maxMessages} messages can be run at once under this plan. Shorten the conversation or split the run.`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { maxMessages },
      },
    );
    this.name = "PromptMessagesTooManyError";
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

/** The read-only prompt process deliberately has no execution engine or workflow peer. */
export class PromptPlaygroundUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "Prompt playground execution is not available on this process", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "PromptPlaygroundUnavailableError";
  }
}

export class CrossOriginRefusedError extends HandledError {
  declare readonly code: "cross_origin_refused";

  constructor() {
    super("cross_origin_refused", "This endpoint only accepts requests from the LangWatch app", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "CrossOriginRefusedError";
  }
}

export class PromptTagInvalidError extends HandledError {
  declare readonly code: "prompt_tag_invalid";

  constructor(message: string) {
    super("prompt_tag_invalid", message, { httpStatus: 400, fault: "customer" });
    this.name = "PromptTagInvalidError";
  }
}

export class PromptTagTakenError extends HandledError {
  declare readonly code: "prompt_tag_conflict";

  constructor(message: string) {
    super("prompt_tag_conflict", message, { httpStatus: 409, fault: "customer" });
    this.name = "PromptTagTakenError";
  }
}

export class PromptTagProtectedRefusalError extends HandledError {
  declare readonly code: "prompt_tag_protected";

  constructor(message: string) {
    super("prompt_tag_protected", message, { httpStatus: 400, fault: "customer" });
    this.name = "PromptTagProtectedRefusalError";
  }
}

export class PromptHasNoCopiesError extends HandledError {
  declare readonly code: "prompt_has_no_copies";

  constructor() {
    super("prompt_has_no_copies", "This prompt has no copies to push to", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptHasNoCopiesError";
  }
}

export class PromptNoCopiesSelectedError extends HandledError {
  declare readonly code: "prompt_no_copies_selected";

  constructor() {
    super("prompt_no_copies_selected", "No valid copies selected to push to", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "PromptNoCopiesSelectedError";
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

/** No such tag in the organization's catalog. */
export class PromptTagMissingError extends NotFoundError {
  declare readonly code: "prompt_tag_not_found";

  constructor(name: string) {
    super("prompt_tag_not_found", "Tag", name, { meta: { name } });
    this.name = "PromptTagMissingError";
  }
}

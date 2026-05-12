import { HTTPException } from "hono/http-exception";

import {
  SystemPromptConflictError,
  SystemPromptRequiredError,
} from "~/server/prompt-config/errors";

/**
 * Maps system-prompt DomainErrors thrown by the prompt service to Hono HTTP
 * exceptions with the correct status code.
 *
 *   - {@link SystemPromptConflictError} → 409 Conflict
 *     (both top-level `prompt` and a system message supplied)
 *   - {@link SystemPromptRequiredError} → 400 Bad Request
 *     (neither supplied — added in #3196)
 *
 * Any other error type is re-thrown unchanged so the global handler can deal
 * with it. The error's own `message` is forwarded as the response body, since
 * both DomainErrors carry user-facing copy.
 *
 * @param error - The error to handle
 * @returns void
 */
export const handleSystemPromptConflict = (error: any) => {
  if (error instanceof SystemPromptRequiredError) {
    throw new HTTPException(400, {
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof SystemPromptConflictError) {
    throw new HTTPException(409, {
      message: error.message,
      cause: error,
    });
  }
};

import { HTTPException } from "hono/http-exception";

import { SystemPromptConflictError } from "~/server/prompt-config/errors";

/**
 * Handles a conflict error by throwing a 409 error with a message
 * indicating that the prompt handle already exists for the given scope.
 * If the error is not a conflict error, it will be re-thrown, it does nothing.
 *
 * @param error - The error to handle
 * @returns void
 */
export const handleSystemPromptConflict = (error: any) => {
  if (error instanceof SystemPromptConflictError) {
    throw new HTTPException(409, {
      message: error.message,
      cause: error,
    });
  }
};

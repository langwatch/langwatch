import { PromptScope } from "@prisma/client";
import { HTTPException } from "hono/http-exception";

/**
 * Handles a conflict error by throwing a 409 error with a message
 * indicating that the prompt handle already exists for the given scope.
 * If the error is not a conflict error, it will be re-thrown, it does nothing.
 *
 * @param error - The error to handle
 * @returns void
 */
export const handlePossibleConflictError = (
  error: any,
  scope: PromptScope = PromptScope.PROJECT
) => {
  if (error.code === "P2002" && error.meta?.target?.includes("handle")) {
    throw new HTTPException(409, {
      message: `Prompt handle already exists for scope ${scope}`,
      cause: error,
    });
  }
};

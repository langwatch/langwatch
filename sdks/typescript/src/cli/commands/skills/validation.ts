/**
 * The one way a `langwatch skills …` command rejects bad input.
 *
 * It lives in its own module rather than in `shared.ts` because the installer
 * validates `--dir` too, and `shared.ts` already imports the installer — a
 * cycle the module graph does not need.
 */
import { commandValidationError } from "../../utils/errorOutput";

// Throw validation errors as branded Error instances for proper error handling.
export const throwValidationError = (
  message: string,
  meta: Record<string, unknown> = {},
): never => {
  throw Object.assign(new Error(message), commandValidationError(message, meta));
};

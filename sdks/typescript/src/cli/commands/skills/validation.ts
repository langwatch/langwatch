/**
 * The one way a `langwatch skills …` command rejects bad input. Lives in
 * its own module, not `shared.ts`, because the installer validates `--dir`
 * too and `shared.ts` already imports the installer -- an avoidable cycle.
 */
import { commandValidationError } from "../../utils/errorOutput";

// Throw validation errors as branded Error instances for proper error handling.
export const throwValidationError = (
  message: string,
  meta: Record<string, unknown> = {},
): never => {
  throw Object.assign(new Error(message), commandValidationError(message, meta));
};

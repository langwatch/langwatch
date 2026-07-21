/**
 * The one way a `langwatch skills …` command rejects bad input.
 *
 * It lives in its own module rather than in `shared.ts` because the installer
 * validates `--dir` too, and `shared.ts` already imports the installer — a
 * cycle the module graph does not need.
 */
import { commandValidationError } from "../../utils/errorOutput";

/**
 * Throw a validation failure as a real Error that still carries the domain
 * brand — eslint's only-throw-error demands an Error instance, while
 * `handledErrorFromThrown` recognises the failure by the brand on the thrown
 * value itself (it reads those fields before unwrapping anything).
 *
 * Call it as `return throwValidationError(...)`: a bare call compiles but
 * TypeScript's control-flow analysis does not treat it as exiting the block,
 * so narrowing after it is lost.
 */
export const throwValidationError = (
  message: string,
  meta: Record<string, unknown> = {},
): never => {
  throw Object.assign(new Error(message), commandValidationError(message, meta));
};

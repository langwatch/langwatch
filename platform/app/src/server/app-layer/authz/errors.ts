/**
 * The failures a grant write reports to its caller.
 *
 * Separate from `./ledger.ts` so a caller can catch one without importing the
 * writer, and so a test of a caller can name the failure without standing the
 * whole ledger up.
 *
 * @see dev/docs/best_practices/error-handling.md
 */
import { HandledError } from "@langwatch/handled-error";

/** The durable write has not become readable within the confirmation window. */
export class AuthzGrantNotConfirmedError extends HandledError {
  declare readonly code: "authz_grant_not_confirmed";

  constructor() {
    super(
      "authz_grant_not_confirmed",
      "Your access change is still processing. Refresh to check its status before trying again.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "AuthzGrantNotConfirmedError";
  }
}

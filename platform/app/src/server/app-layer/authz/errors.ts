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

/**
 * The append is durable, but the projection did not make the rows readable
 * inside the read-your-writes window, and the caller asked to be told
 * (`requireProjection`).
 *
 * Only a caller whose NEXT step hands out access that depends on those rows
 * asks for this. Minting an API key is the case it exists for: the key row
 * and its grants cannot share a transaction, so the key is born revoked and
 * activated last, and activating it on an unconfirmed grant is what produced
 * a live token that every route then refused.
 *
 * Handled and named because the caller can act on it (retry, once the fold
 * has drained) and because it is not a validation failure. `fault: "platform"`
 * — a lagging fold is ours. The detail (which write, which organization) goes
 * to the log line; the message stays customer-safe.
 */
export class AuthzGrantNotConfirmedError extends HandledError {
  declare readonly code: "authz_grant_not_confirmed";

  constructor() {
    super(
      "authz_grant_not_confirmed",
      "We could not confirm the access change in time. Nothing was granted. Try again in a moment.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "AuthzGrantNotConfirmedError";
  }
}

import { HandledError } from "@langwatch/handled-error";

/**
 * The refusals the sign-in and sign-up screens can be given, as typed errors.
 *
 * These used to be bare `TRPCError`s, which is the shape that reaches a
 * customer as "unknown error" with a trace id (ADR-045). Every one of them is
 * a failure we can NAME and the caller can ACT on — wait, or use a different
 * way in — so every one of them is handled, with a stable code the client
 * presentation registry keys the words off.
 *
 * All three are `fault: "customer"`, and that is the honest reading rather
 * than the flattering one: a rate limit is somebody asking too often, and a
 * deployment that does not offer direct registration is refusing a request
 * that was never available to make. None of them is an incident.
 */

/**
 * Too many attempts, on any of the screens' endpoints.
 *
 * One code for all of them on purpose. The customer-facing difference between
 * "too many sign-in attempts" and "too many sign-up attempts" is nothing —
 * both mean wait — and a code per endpoint would be seven registry entries
 * saying the same sentence. What DOES differ is how long, so that is what the
 * error carries.
 */
export class AuthRateLimitedError extends HandledError {
  declare readonly code: "auth_rate_limited";

  constructor(input?: { retryAfterSeconds?: number }) {
    super("auth_rate_limited", "Too many attempts. Please try again later.", {
      httpStatus: 429,
      fault: "customer",
      // The one field a screen actually renders off this: the countdown the
      // submit button sits behind. `meta` is a client contract, not a
      // scratchpad — nothing else about the limit belongs here.
      meta: input?.retryAfterSeconds
        ? { retryAfterSeconds: input.retryAfterSeconds }
        : void 0,
    });
    this.name = "AuthRateLimitedError";
  }
}

/**
 * The signed-in caller has no address to send a confirmation to.
 *
 * Reachable only by an account created without one — a federated sign-in from
 * a provider that returned no email, or a row seeded by an operator. There is
 * nothing to resend, and the way out is to add an address, which is why this
 * is worth naming rather than degrading to "unknown".
 */
export class NoAddressToConfirmError extends HandledError {
  declare readonly code: "auth_no_address_to_confirm";

  constructor() {
    super(
      "auth_no_address_to_confirm",
      "This account has no email address to confirm.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "NoAddressToConfirmError";
  }
}

/**
 * This deployment does not create accounts from a password form: it routes
 * sign-in to an identity provider instead.
 *
 * The caller's move is to use that provider, so the screen can say so — which
 * is the whole reason this is handled rather than a generic refusal.
 */
export class DirectRegistrationUnavailableError extends HandledError {
  declare readonly code: "auth_direct_registration_unavailable";

  constructor() {
    super(
      "auth_direct_registration_unavailable",
      "This deployment signs you in through your identity provider, so accounts are not created with a password here.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "DirectRegistrationUnavailableError";
  }
}

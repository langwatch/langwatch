import type { RateLimitAxis } from "@langwatch/contracts/agent-onboarding";
import { HandledError } from "@langwatch/handled-error";

/**
 * The operator turned anonymous provisioning off for this deployment. A
 * self-hosted install should be able to refuse account creation without
 * patching code, and the message has to say so — otherwise it reads as a bug.
 */
export class AnonymousProvisioningDisabledError extends HandledError {
  declare readonly code: "anonymous_provisioning_disabled";

  constructor() {
    super(
      "anonymous_provisioning_disabled",
      "This LangWatch instance does not create temporary accounts. Sign in, or ask an administrator for a project API key.",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "AnonymousProvisioningDisabledError";
  }
}

/**
 * Deliberately covers all three of "no such token", "not your token" and
 * "already deleted". Answering them differently turns the endpoint into an
 * oracle for whether a given token is real.
 */
export class EphemeralAccountNotFoundError extends HandledError {
  declare readonly code: "ephemeral_account_not_found";

  constructor() {
    super(
      "ephemeral_account_not_found",
      "This temporary account is not available.",
      { httpStatus: 404, fault: "customer" },
    );
    this.name = "EphemeralAccountNotFoundError";
  }
}

/** Past the deletion deadline. The data is gone, and the copy says so. */
export class EphemeralAccountExpiredError extends HandledError {
  declare readonly code: "ephemeral_account_expired";

  constructor() {
    super(
      "ephemeral_account_expired",
      "This temporary account passed its 30-day window and its data has been deleted.",
      {
        httpStatus: 410,
        fault: "customer",
        tips: ["Run `npx langwatch claude` to start a new one."],
      },
    );
    this.name = "EphemeralAccountExpiredError";
  }
}

/**
 * Someone already attached an identity. Refused rather than silently re-run:
 * a second claim would otherwise quietly hand a stranger access to a
 * workspace its owner has been using for weeks.
 */
export class EphemeralAccountAlreadyClaimedError extends HandledError {
  declare readonly code: "ephemeral_account_already_claimed";

  constructor() {
    super(
      "ephemeral_account_already_claimed",
      "This account has already been claimed.",
      {
        httpStatus: 409,
        fault: "customer",
        tips: ["Sign in to LangWatch to reach it."],
      },
    );
    this.name = "EphemeralAccountAlreadyClaimedError";
  }
}

/**
 * Unknown, expired or already-exchanged handoff — one answer for all three,
 * for the same reason as the account lookup above.
 */
export class ClaimHandoffNotFoundError extends HandledError {
  declare readonly code: "claim_handoff_not_found";

  constructor() {
    super(
      "claim_handoff_not_found",
      "This link has expired. Run the command again to get a fresh one.",
      { httpStatus: 410, fault: "customer" },
    );
    this.name = "ClaimHandoffNotFoundError";
  }
}

/**
 * The PKCE verifier did not hash to the stored challenge. This is what makes
 * the handoff code safe to put in a URL that gets pasted into chat: whoever
 * reads it over your shoulder cannot finish the exchange.
 */
export class ClaimHandoffVerifierMismatchError extends HandledError {
  declare readonly code: "claim_handoff_verifier_mismatch";

  constructor() {
    super(
      "claim_handoff_verifier_mismatch",
      "This claim could not be verified. Run the command again to start a new one.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "ClaimHandoffVerifierMismatchError";
  }
}

/** No signed-in identity to attach. */
export class ClaimRequiresIdentityError extends HandledError {
  declare readonly code: "claim_requires_identity";

  constructor() {
    super("claim_requires_identity", "Sign in to claim this account.", {
      httpStatus: 401,
      fault: "customer",
      tips: [
        "Run `langwatch claim` and follow the link it prints to sign in from your browser.",
      ],
    });
    this.name = "ClaimRequiresIdentityError";
  }
}

/**
 * A metering axis refused the request. `retryAfterSeconds` rides in meta so
 * the route can set `Retry-After` from the error rather than recomputing it,
 * and `axis` so an operator can tell one abusive host from a saturated
 * endpoint without reading the limiter's logs.
 */
export class OnboardingRateLimitedError extends HandledError {
  declare readonly code: "rate_limited";

  constructor(params: { axis: RateLimitAxis; retryAfterSeconds: number }) {
    super("rate_limited", "Too many requests. Try again shortly.", {
      httpStatus: 429,
      fault: "customer",
      meta: {
        axis: params.axis,
        retryAfterSeconds: params.retryAfterSeconds,
      },
    });
    this.name = "OnboardingRateLimitedError";
  }
}

/**
 * The limiter's backing store is unreachable, so `/provision` fails closed.
 * An open-on-failure limiter in front of unauthenticated account creation is
 * precisely the state an abuser waits for, and provisioning is not important
 * enough to serve unmetered.
 */
export class OnboardingUnavailableError extends HandledError {
  declare readonly code: "onboarding_unavailable";

  constructor(cause?: Error) {
    super(
      "onboarding_unavailable",
      "Temporary accounts are unavailable right now. Try again shortly.",
      {
        httpStatus: 503,
        fault: "platform",
        reasons: cause ? [cause] : undefined,
      },
    );
    this.name = "OnboardingUnavailableError";
  }
}

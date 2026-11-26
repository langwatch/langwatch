// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError, NotFoundError } from "@langwatch/handled-error";

/** The person a test was asked for is not an active member of the organization named. */
export class DigestMemberNotFoundError extends NotFoundError {
  declare readonly code: "digest_member_not_found";

  constructor(userId: string) {
    super("digest_member_not_found", { resource: "Organization member", id: userId });
    this.name = "DigestMemberNotFoundError";
  }
}

/** An unsubscribe link whose signature does not match, or that names nothing: refused. */
export class DigestLinkInvalidError extends HandledError {
  declare readonly code: "digest_link_invalid";

  constructor() {
    super("digest_link_invalid", "This link is invalid or has expired.", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "DigestLinkInvalidError";
  }
}

/** The member's pick has nothing to show this week (no "what's new" card is published). */
export class DigestNothingToSendError extends HandledError {
  declare readonly code: "digest_nothing_to_send";

  constructor(userId: string) {
    super("digest_nothing_to_send", "This member's weekly email has nothing to show this week.", {
      meta: { userId },
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "DigestNothingToSendError";
  }
}

/** The operator asked for a test but has no address to send it to. */
export class DigestOperatorAddressMissingError extends HandledError {
  declare readonly code: "digest_operator_address_missing";

  constructor() {
    super(
      "digest_operator_address_missing",
      "Your account has no email address, so a test digest can't be sent to you.",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "DigestOperatorAddressMissingError";
  }
}

/** A test was asked for a member who opted out of the digest. */
export class DigestMemberUnsubscribedError extends HandledError {
  declare readonly code: "digest_member_unsubscribed";

  constructor(userId: string) {
    super("digest_member_unsubscribed", "This member opted out of the digest.", {
      meta: { userId },
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "DigestMemberUnsubscribedError";
  }
}

/** No signing secret is configured, so no unsubscribe link can be signed or checked. */
export class DigestLinksUnavailableError extends HandledError {
  declare readonly code: "digest_links_unavailable";

  constructor() {
    super("digest_links_unavailable", "Unsubscribe links are not available right now.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "DigestLinksUnavailableError";
  }
}

/** No public base URL is configured, so no link the email carries can point back at us. */
export class DigestPublicBaseUrlMissingError extends HandledError {
  declare readonly code: "digest_public_base_url_missing";

  constructor() {
    super(
      "digest_public_base_url_missing",
      "The deployment's public address is not configured, so digest emails can't be sent.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "DigestPublicBaseUrlMissingError";
  }
}

/** One caller made too many digest unsubscribe-page attempts in the window; waiting is the remedy. */
export class DigestUnsubscribeRateLimitedError extends HandledError {
  declare readonly code: "digest_unsubscribe_rate_limited";

  constructor() {
    super("digest_unsubscribe_rate_limited", "Too many attempts. Wait a minute and try again.", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
    });
    this.name = "DigestUnsubscribeRateLimitedError";
  }
}

/** Staff impersonating a person may look at their email choice but never change it. */
export class DigestImpersonationRefusedError extends HandledError {
  declare readonly code: "digest_impersonation_refused";

  constructor() {
    super(
      "digest_impersonation_refused",
      "An email preference can't be changed while impersonating someone.",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "DigestImpersonationRefusedError";
  }
}

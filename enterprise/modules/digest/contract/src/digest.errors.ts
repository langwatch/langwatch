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

/** A test was asked for an organization that is not enrolled in the digest. */
export class DigestOrganizationNotEnrolledError extends HandledError {
  declare readonly code: "digest_organization_not_enrolled";

  constructor(organizationId: string) {
    super("digest_organization_not_enrolled", "This organization is not enrolled in the digest.", {
      meta: { organizationId },
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "DigestOrganizationNotEnrolledError";
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

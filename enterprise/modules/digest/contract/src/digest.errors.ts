// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError, NotFoundError } from "@langwatch/handled-error";

/** A digest link whose signature does not match, or that names nothing: refused as invalid. */
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

/** A signed click whose send holds no such link key: nothing redirects. */
export class DigestLinkNotFoundError extends NotFoundError {
  declare readonly code: "digest_link_not_found";

  constructor(linkKey: string) {
    super("digest_link_not_found", { resource: "Digest link", id: linkKey });
    this.name = "DigestLinkNotFoundError";
  }
}

/** The person previewed or tested is not a member of the organization named. */
export class DigestMemberNotFoundError extends NotFoundError {
  declare readonly code: "digest_member_not_found";

  constructor(userId: string) {
    super("digest_member_not_found", { resource: "Organization member", id: userId });
    this.name = "DigestMemberNotFoundError";
  }
}

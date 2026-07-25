import { HandledError } from "@langwatch/handled-error";

/**
 * A share link that cannot be resolved. Deliberately covers BOTH "no such
 * token" and "the link exists but sharing is disabled / its trace is gone":
 * a caller probing tokens must never learn that a link exists behind a
 * kill switch. `handledErrorMiddleware` maps this to NOT_FOUND on the wire.
 */
export class ShareLinkNotFoundError extends HandledError {
  declare readonly code: "share_link_not_found";

  constructor() {
    super("share_link_not_found", "This share link is not available.", {
      httpStatus: 404,
    });
    this.name = "ShareLinkNotFoundError";
  }
}

export class ShareLinkExpiredError extends HandledError {
  declare readonly code: "share_link_expired";

  constructor() {
    super("share_link_expired", "This share link has expired.", {
      httpStatus: 403,
    });
    this.name = "ShareLinkExpiredError";
  }
}

export class ShareLinkExhaustedError extends HandledError {
  declare readonly code: "share_link_exhausted";

  constructor() {
    super(
      "share_link_exhausted",
      "This share link has already been viewed.",
      { httpStatus: 403 },
    );
    this.name = "ShareLinkExhaustedError";
  }
}

/**
 * The viewer is not in the link's audience (ORGANIZATION / PROJECT
 * visibility). 401 — not 403 — so an anonymous viewer is invited to sign in
 * rather than told the link is dead.
 */
export class ShareLinkForbiddenError extends HandledError {
  declare readonly code: "share_link_forbidden";

  constructor() {
    super(
      "share_link_forbidden",
      "You do not have access to this shared item.",
      { httpStatus: 401 },
    );
    this.name = "ShareLinkForbiddenError";
  }
}

export class TraceSharingDisabledError extends HandledError {
  declare readonly code: "trace_sharing_disabled";

  constructor() {
    super(
      "trace_sharing_disabled",
      "Trace sharing is disabled for this project",
      { httpStatus: 403 },
    );
    this.name = "TraceSharingDisabledError";
  }
}

/**
 * Too many reads of the anonymous share surface in the window. Distinct from
 * the "link is spent" errors: nothing is wrong with the link, and the viewer
 * can simply try again — so the copy says so rather than implying the share
 * is dead.
 */
export class ShareReadRateLimitedError extends HandledError {
  declare readonly code: "share_read_rate_limited";

  constructor() {
    super(
      "share_read_rate_limited",
      "This shared trace is being opened too often right now. Try again in a moment.",
      { httpStatus: 429 },
    );
    this.name = "ShareReadRateLimitedError";
  }
}

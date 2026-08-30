import { HandledError } from "@langwatch/handled-error";

import { remediation } from "../error-remediation";

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
    super("share_link_exhausted", "This share link has already been viewed.", {
      httpStatus: 403,
    });
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
 * The mint named a permission the share tier does not confer. Handled, not
 * unknown: we know exactly what went wrong (the value is outside
 * `SHARE_LINK_PERMISSIONS`), and the caller can act on it by naming one that
 * is in the set — which `meta.allowed` hands them, so an agent does not have
 * to guess. 400, and sharer-facing: an anonymous viewer can never reach it.
 */
export class ShareLinkPermissionNotAllowedError extends HandledError {
  declare readonly code: "share_permission_not_allowed";

  constructor(allowed: readonly string[]) {
    super(
      "share_permission_not_allowed",
      "That is not something a share link can grant.",
      {
        httpStatus: 400,
        // A client contract, not a scratchpad: the share dialog renders the
        // options from it and an API caller reads it to correct the request.
        meta: { allowed: [...allowed] },
        ...remediation("share_permission_not_allowed"),
      },
    );
    this.name = "ShareLinkPermissionNotAllowedError";
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

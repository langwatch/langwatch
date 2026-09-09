import { HandledError } from "@langwatch/handled-error";

export class PinnedToActiveShareError extends Error {
  readonly name = "PinnedToActiveShareError" as const;
}

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

export class ShareLinkForbiddenError extends HandledError {
  declare readonly code: "share_link_forbidden";

  constructor() {
    super("share_link_forbidden", "You do not have access to this shared item.", {
      httpStatus: 401,
    });
    this.name = "ShareLinkForbiddenError";
  }
}

export class TraceSharingDisabledError extends HandledError {
  declare readonly code: "trace_sharing_disabled";

  constructor() {
    super("trace_sharing_disabled", "Trace sharing is disabled for this project", {
      httpStatus: 403,
    });
    this.name = "TraceSharingDisabledError";
  }
}

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

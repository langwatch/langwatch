import { HandledError } from "@langwatch/handled-error";

export class BroadcasterNotActiveError extends HandledError {
  declare readonly code: "broadcaster_not_active";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("broadcaster_not_active", "This broadcaster is not in an active state, you may retry.", {
      httpStatus: 503,
      fault: "platform",
      ...options,
    });
    this.name = "BroadcasterNotActiveError";
  }
}

/**
 * One member tried to remove another member's presence session. Seeing the project's
 * presence takes `traces:view`, which every member has, so the permission is not what
 * separates them: a published session is removed by the person publishing it.
 */
export class PresenceSessionNotOwnedError extends HandledError {
  declare readonly code: "insufficient_permissions";

  constructor() {
    super("insufficient_permissions", "That presence session belongs to someone else.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "PresenceSessionNotOwnedError";
  }
}

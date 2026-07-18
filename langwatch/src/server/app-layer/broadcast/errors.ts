import { HandledError } from "../handled-error";

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

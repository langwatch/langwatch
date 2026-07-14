import { DomainError } from "../domain-error";

export class BroadcasterNotActiveError extends DomainError {
  declare readonly kind: "broadcaster_not_active";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("broadcaster_not_active", "This broadcaster is not in an active state, you may retry.", {
      httpStatus: 503,
      ...options,
    });
    this.name = "BroadcasterNotActiveError";
  }
}

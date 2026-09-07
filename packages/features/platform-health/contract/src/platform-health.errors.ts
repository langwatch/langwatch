import { HandledError } from "@langwatch/handled-error";

/**
 * The monitoring key was absent or wrong. Deliberately says nothing about
 * which: a monitor holds one key, and telling a caller which half of the
 * check failed is an oracle nobody legitimate needs.
 */
export class PlatformHealthUnauthorizedError extends HandledError {
  declare readonly code: "platform_health_unauthorized";

  constructor() {
    super("platform_health_unauthorized", "The platform health key was not accepted.", {
      httpStatus: 401,
    });
    this.name = "PlatformHealthUnauthorizedError";
  }
}

import type { LimitType } from "./types";

/**
 * Domain error thrown when an organization has reached its limit for a resource type.
 * This error is framework-agnostic and should be caught and mapped to
 * HTTP/tRPC errors by the router layer.
 */
export class LimitExceededError extends Error {
  public readonly name = "LimitExceededError";

  constructor(
    public readonly limitType: LimitType,
    public readonly current: number,
    public readonly max: number,
  ) {
    super(`You have reached the maximum number of ${limitType}`);
  }
}

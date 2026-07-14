import { DomainError } from "~/server/app-layer/domain-error";
import { LIMIT_TYPE_LABELS } from "./constants";
import type { LimitType } from "./types";

/**
 * Domain error thrown when an organization has reached its limit for a resource type.
 * This error is framework-agnostic and should be caught and mapped to
 * HTTP/tRPC errors by the router layer.
 */
export class LimitExceededError extends DomainError {
  declare readonly kind: "resource_limit_exceeded";

  constructor(
    public readonly limitType: LimitType,
    public readonly current: number,
    public readonly max: number,
  ) {
    super(
      "resource_limit_exceeded",
      `You have reached the maximum number of ${LIMIT_TYPE_LABELS[limitType]}`,
      {
        meta: { limitType, current, max },
        httpStatus: 403,
      },
    );
    this.name = "LimitExceededError";
  }
}

/**
 * Domain error thrown when a project is not found or has no organization.
 * This error is framework-agnostic and should be caught and mapped to
 * HTTP/tRPC errors by the router layer.
 */
export class ProjectNotFoundError extends Error {
  public readonly name = "ProjectNotFoundError";

  constructor(public readonly projectId: string) {
    super(`Project not found: ${projectId}`);
  }
}

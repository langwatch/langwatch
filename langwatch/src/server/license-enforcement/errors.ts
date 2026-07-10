import { DomainError } from "~/server/app-layer/domain-error";
import { LIMIT_TYPE_LABELS } from "./constants";
import type { LimitResolution, LimitType } from "./types";

/**
 * Domain error thrown when an organization has reached its limit for a resource type.
 * This error is framework-agnostic and should be caught and mapped to
 * HTTP/tRPC errors by the router layer.
 *
 * `resolution` (ADR-039 Decision 5) tells the caller how the denial can be
 * resolved — purchase_seat, upgrade, or hard_cap — so every UI and API
 * surface routes the user forward instead of dead-ending them.
 */
export class LimitExceededError extends DomainError {
  declare readonly kind: "resource_limit_exceeded";

  constructor(
    public readonly limitType: LimitType,
    public readonly current: number,
    public readonly max: number,
    public readonly resolution: LimitResolution = "upgrade",
  ) {
    super(
      "resource_limit_exceeded",
      `You have reached the maximum number of ${LIMIT_TYPE_LABELS[limitType]}`,
      {
        meta: { limitType, current, max, resolution },
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

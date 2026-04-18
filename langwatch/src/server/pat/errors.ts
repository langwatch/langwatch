import { DomainError, NotFoundError } from "../app-layer/domain-error";

/**
 * Thrown when a PAT cannot be located by id.
 */
export class PatNotFoundError extends NotFoundError {
  declare readonly kind: "pat_not_found";

  constructor(patId: string, options: { reasons?: readonly Error[] } = {}) {
    super("pat_not_found", "Personal Access Token", patId, {
      meta: { patId },
      ...options,
    });
    this.name = "PatNotFoundError";
  }
}

/**
 * Thrown when a user attempts to modify a PAT they do not own.
 */
export class PatNotOwnedError extends DomainError {
  declare readonly kind: "pat_not_owned";

  constructor(
    patId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("pat_not_owned", "Not authorized to modify this Personal Access Token", {
      meta: { patId },
      httpStatus: 403,
      ...options,
    });
    this.name = "PatNotOwnedError";
  }
}

/**
 * Thrown when a PAT is already revoked and cannot be revoked again.
 */
export class PatAlreadyRevokedError extends DomainError {
  declare readonly kind: "pat_already_revoked";

  constructor(
    patId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("pat_already_revoked", "Personal Access Token is already revoked", {
      meta: { patId },
      httpStatus: 409,
      ...options,
    });
    this.name = "PatAlreadyRevokedError";
  }
}

/**
 * Thrown when the user's PAT ceiling denies a requested permission at runtime.
 * Maps to HTTP 403 — the request was understood but the PAT's effective
 * permission set (intersection of requested scopes ∩ user's current role)
 * does not grant the action.
 */
export class PatPermissionDeniedError extends DomainError {
  declare readonly kind: "pat_permission_denied";

  constructor(
    permission: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super(
      "pat_permission_denied",
      `Personal Access Token does not grant required permission: ${permission}`,
      {
        meta: { permission, ...options.meta },
        httpStatus: 403,
        reasons: options.reasons,
      },
    );
    this.name = "PatPermissionDeniedError";
  }
}

/**
 * Thrown at PAT creation time when a requested scope binding exceeds the
 * creator's ceiling — e.g., binding a role the creator does not hold on the
 * target scope. Surfaced to the user before the token is persisted.
 */
export class PatScopeViolationError extends DomainError {
  declare readonly kind: "pat_scope_violation";

  constructor(
    message: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super("pat_scope_violation", message, {
      httpStatus: 403,
      ...options,
    });
    this.name = "PatScopeViolationError";
  }
}

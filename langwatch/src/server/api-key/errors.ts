import { DomainError, NotFoundError } from "../app-layer/domain-error";

/**
 * Thrown when an API key cannot be located by id.
 */
export class ApiKeyNotFoundError extends NotFoundError {
  declare readonly kind: "api_key_not_found";

  constructor(apiKeyId: string, options: { reasons?: readonly Error[] } = {}) {
    super("api_key_not_found", "API Key", apiKeyId, {
      meta: { apiKeyId },
      ...options,
    });
    this.name = "ApiKeyNotFoundError";
  }
}

/**
 * Thrown when a user attempts to modify an API key they do not own.
 */
export class ApiKeyNotOwnedError extends DomainError {
  declare readonly kind: "api_key_not_owned";

  constructor(
    apiKeyId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("api_key_not_owned", "Not authorized to modify this API Key", {
      meta: { apiKeyId },
      httpStatus: 403,
      ...options,
    });
    this.name = "ApiKeyNotOwnedError";
  }
}

/**
 * Thrown when an API key is already revoked and cannot be revoked again.
 */
export class ApiKeyAlreadyRevokedError extends DomainError {
  declare readonly kind: "api_key_already_revoked";

  constructor(
    apiKeyId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("api_key_already_revoked", "API Key is already revoked", {
      meta: { apiKeyId },
      httpStatus: 409,
      ...options,
    });
    this.name = "ApiKeyAlreadyRevokedError";
  }
}

/**
 * Thrown when the API key's ceiling denies a requested permission at runtime.
 * Maps to HTTP 403 — the request was understood but the API key's effective
 * permission set (intersection of requested scopes ∩ user's current role)
 * does not grant the action.
 */
export class ApiKeyPermissionDeniedError extends DomainError {
  declare readonly kind: "api_key_permission_denied";

  constructor(
    permission: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super(
      "api_key_permission_denied",
      `API Key does not grant required permission: ${permission}`,
      {
        meta: { permission, ...options.meta },
        httpStatus: 403,
        reasons: options.reasons,
      },
    );
    this.name = "ApiKeyPermissionDeniedError";
  }
}

/**
 * Thrown at API key creation time when a requested scope binding exceeds the
 * creator's ceiling — e.g., binding a role the creator does not hold on the
 * target scope. Surfaced to the user before the token is persisted.
 */
export class ApiKeyScopeViolationError extends DomainError {
  declare readonly kind: "api_key_scope_violation";

  constructor(
    message: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super("api_key_scope_violation", message, {
      httpStatus: 403,
      ...options,
    });
    this.name = "ApiKeyScopeViolationError";
  }
}

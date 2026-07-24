import { HandledError, NotFoundError } from "@langwatch/handled-error";

import { remediation } from "../app-layer/error-remediation";

/**
 * Thrown when an API key cannot be located by id.
 */
export class ApiKeyNotFoundError extends NotFoundError {
  declare readonly code: "api_key_not_found";

  constructor(apiKeyId: string, options: { reasons?: readonly Error[] } = {}) {
    super("api_key_not_found", "API Key", apiKeyId, {
      meta: { apiKeyId },
      ...remediation("api_key_not_found"),
      ...options,
    });
    this.name = "ApiKeyNotFoundError";
  }
}

/**
 * Thrown when a user attempts to modify an API key they do not own.
 */
export class ApiKeyNotOwnedError extends HandledError {
  declare readonly code: "api_key_not_owned";

  constructor(
    apiKeyId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("api_key_not_owned", "Not authorized to modify this API Key", {
      meta: { apiKeyId },
      httpStatus: 403,
      ...remediation("api_key_not_owned"),
      ...options,
    });
    this.name = "ApiKeyNotOwnedError";
  }
}

/**
 * Thrown when an API key is already revoked and cannot be revoked again.
 */
export class ApiKeyAlreadyRevokedError extends HandledError {
  declare readonly code: "api_key_already_revoked";

  constructor(
    apiKeyId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("api_key_already_revoked", "API Key is already revoked", {
      meta: { apiKeyId },
      httpStatus: 409,
      ...remediation("api_key_already_revoked"),
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
export class ApiKeyPermissionDeniedError extends HandledError {
  declare readonly code: "api_key_permission_denied";

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
        ...remediation("api_key_permission_denied"),
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
/**
 * Thrown when a caller tries to create a key with — or rename a key to — a
 * name in HIDDEN_SYSTEM_KEY_NAMES. Those names mark keys the product mints
 * and retires on its own, and the listings + by-id mutation guards key on
 * them; letting a customer claim one would make their key invisible AND
 * unrevocable (the system-managed guard refuses mutations on it).
 */
export class ApiKeyReservedNameError extends HandledError {
  declare readonly code: "api_key_reserved_name";

  constructor(
    name: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super(
      "api_key_reserved_name",
      `The API key name "${name}" is reserved for keys LangWatch manages`,
      {
        httpStatus: 422,
        ...remediation("api_key_reserved_name"),
        ...options,
        // After ...options so a caller-supplied meta can add fields but never
        // drop the attempted name this class promises to carry.
        meta: { ...options.meta, name },
      },
    );
    this.name = "ApiKeyReservedNameError";
  }
}

export class ApiKeyScopeViolationError extends HandledError {
  declare readonly code: "api_key_scope_violation";

  constructor(
    message: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super("api_key_scope_violation", message, {
      httpStatus: 403,
      ...remediation("api_key_scope_violation"),
      ...options,
    });
    this.name = "ApiKeyScopeViolationError";
  }
}

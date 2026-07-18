import { docsUrl } from "~/utils/docsUrl";

import { HandledError, NotFoundError } from "../app-layer/handled-error";

/**
 * Thrown when an API key cannot be located by id.
 */
export class ApiKeyNotFoundError extends NotFoundError {
  declare readonly code: "api_key_not_found";

  constructor(apiKeyId: string, options: { reasons?: readonly Error[] } = {}) {
    super("api_key_not_found", "API Key", apiKeyId, {
      meta: { apiKeyId },
      tips: [
        "Check the API key id — the key may have been deleted or never created",
        "List the keys on the organization to find the right id",
      ],
      docsUrl: docsUrl("/api-reference/api-keys/overview"),
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
      tips: [
        "Ask the key's owner or an organization admin to make this change",
      ],
      docsUrl: docsUrl("/api-reference/api-keys/overview"),
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
      tips: [
        "Revoked keys cannot be reactivated — create a new API key if you need one",
      ],
      docsUrl: docsUrl("/api-reference/api-keys/create-api-key"),
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
        tips: [
          "Re-create the API key with the required scope, or ask an admin to raise your role",
        ],
        docsUrl: docsUrl("/api-reference/api-keys/create-api-key"),
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
      tips: [
        "A key cannot be granted a scope you do not hold yourself — lower the requested scope or ask an admin to create the key",
      ],
      docsUrl: docsUrl("/api-reference/api-keys/create-api-key"),
      ...options,
    });
    this.name = "ApiKeyScopeViolationError";
  }
}

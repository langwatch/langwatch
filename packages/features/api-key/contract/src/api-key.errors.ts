import { HandledError } from "@langwatch/handled-error";

export class ApiKeyNotFoundError extends HandledError {
  declare readonly code: "api_key_not_found";

  constructor(id: string, options: { reasons?: readonly Error[] } = {}) {
    super("api_key_not_found", "API Key not found", {
      meta: { apiKeyId: id },
      httpStatus: 404,
      fault: "customer",
      reasons: options.reasons,
    });
    this.name = "ApiKeyNotFoundError";
  }
}

export class ApiKeyNotOwnedError extends HandledError {
  declare readonly code: "api_key_not_owned";

  constructor(id: string) {
    super("api_key_not_owned", "Not authorized to modify this API Key", {
      meta: { apiKeyId: id },
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ApiKeyNotOwnedError";
  }
}

export class ApiKeyAlreadyRevokedError extends HandledError {
  declare readonly code: "api_key_already_revoked";

  constructor(id: string) {
    super("api_key_already_revoked", "API Key is already revoked", {
      meta: { apiKeyId: id },
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "ApiKeyAlreadyRevokedError";
  }
}

export class ApiKeyReservedNameError extends HandledError {
  declare readonly code: "api_key_reserved_name";

  constructor(name: string) {
    super(
      "api_key_reserved_name",
      `The API key name "${name}" is reserved for keys LangWatch manages`,
      {
        meta: { name },
        httpStatus: 422,
        fault: "customer",
      },
    );
    this.name = "ApiKeyReservedNameError";
  }
}

export class ApiKeyScopeViolationError extends HandledError {
  declare readonly code: "api_key_scope_violation";

  constructor(message: string) {
    super("api_key_scope_violation", message, {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ApiKeyScopeViolationError";
  }
}

export class ApiKeyPermissionDeniedError extends HandledError {
  declare readonly code: "api_key_permission_denied";

  constructor(permission: string, options: { meta?: Record<string, unknown> } = {}) {
    super(
      "api_key_permission_denied",
      `API Key does not grant required permission: ${permission}`,
      {
        meta: { permission, ...options.meta },
        httpStatus: 403,
        fault: "customer",
        tips: [
          "Re-create the API key with the required scope, or ask an admin to raise your role",
        ],
        docsUrl: "https://docs.langwatch.ai/api-reference/api-keys/create-api-key",
      },
    );
    this.name = "ApiKeyPermissionDeniedError";
  }
}

export class ApiKeyPermissionNotDelegableError extends HandledError {
  declare readonly code: "api_key_permission_not_delegable";

  constructor(
    permission: string,
    options: { subject: string; meta?: Record<string, unknown> },
  ) {
    super(
      "api_key_permission_not_delegable",
      `${options.subject} is never granted ${permission}, whatever key or role you use. Make this change in LangWatch yourself.`,
      {
        meta: { permission, ...options.meta },
        httpStatus: 403,
        fault: "customer",
        tips: [
          "A wider key or a higher role does not change this — make the change in LangWatch instead",
        ],
        docsUrl: "https://docs.langwatch.ai/api-reference/api-keys/create-api-key",
      },
    );
    this.name = "ApiKeyPermissionNotDelegableError";
  }
}

export class ProjectVisibilityTooWideError extends HandledError {
  declare readonly code: "project_visibility_too_wide";

  constructor(message: string, options: { meta?: Record<string, unknown> } = {}) {
    super("project_visibility_too_wide", message, {
      meta: options.meta,
      httpStatus: 507,
      fault: "platform",
    });
    this.name = "ProjectVisibilityTooWideError";
  }
}

export class CliKeySelectionInvalidError extends HandledError {
  declare readonly code: "cli_key_selection_invalid";

  constructor(public readonly fieldErrors: Record<string, string[]>) {
    super("cli_key_selection_invalid", "The key selection is not valid", {
      meta: { fieldErrors },
      httpStatus: 422,
      fault: "customer",
    });
    this.name = "CliKeySelectionInvalidError";
  }
}

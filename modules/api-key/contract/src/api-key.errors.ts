import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

export class ApiKeyNotFoundError extends NotFoundError {
  declare readonly code: "api_key_not_found";

  constructor(id: string, options: { reasons?: readonly Error[] } = {}) {
    super("api_key_not_found", "API Key", id, {
      meta: { apiKeyId: id },
      fault: "customer",
      ...remediation("api_key_not_found"),
      reasons: options.reasons,
    });
    this.name = "ApiKeyNotFoundError";
  }
}

/** The privilege a mint asked for and the caller did not hold. */
export type ApiKeyAdminRequiredAction =
  | "create-service-key"
  | "assign-to-another-user"
  | "create-unowned-key";

const ADMIN_REQUIRED_MESSAGES: Readonly<Record<ApiKeyAdminRequiredAction, string>> = {
  "create-service-key": "Only organization admins can create service API keys",
  "assign-to-another-user": "Only organization admins can create API keys for other users",
  "create-unowned-key": "Only organization admins can create API keys that no member owns",
};

/**
 * The caller asked for a key that is not their own to hold: a service key, one
 * minted for somebody else, or one no member owns. Three administrative acts,
 * all taking organization admin — one rule, so one refusal, act in `meta`.
 */
export class ApiKeyAdminRequiredError extends HandledError {
  declare readonly code: "api_key_admin_required";

  constructor(action: ApiKeyAdminRequiredAction) {
    super(
      "api_key_admin_required",
      ADMIN_REQUIRED_MESSAGES[action],
      {
        meta: { action },
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "ApiKeyAdminRequiredError";
  }
}

export class ApiKeyNotOwnedError extends HandledError {
  declare readonly code: "api_key_not_owned";

  constructor(id: string) {
    super("api_key_not_owned", "Not authorized to modify this API Key", {
      meta: { apiKeyId: id },
      httpStatus: 403,
      fault: "customer",
      ...remediation("api_key_not_owned"),
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
      ...remediation("api_key_already_revoked"),
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
        ...remediation("api_key_reserved_name"),
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
      ...remediation("api_key_scope_violation"),
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
        ...remediation("api_key_permission_denied"),
      },
    );
    this.name = "ApiKeyPermissionDeniedError";
  }
}

export class ApiKeyPermissionNotDelegableError extends HandledError {
  declare readonly code: "api_key_permission_not_delegable";

  constructor(permission: string, options: { subject: string; meta?: Record<string, unknown> }) {
    super(
      "api_key_permission_not_delegable",
      `${options.subject} is never granted ${permission}, whatever key or role you use. Make this change in LangWatch yourself.`,
      {
        meta: { permission, ...options.meta },
        httpStatus: 403,
        fault: "customer",
        ...remediation("api_key_permission_not_delegable"),
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
      ...remediation("project_visibility_too_wide"),
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

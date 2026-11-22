import { HandledError } from "@langwatch/handled-error";

/** The scope a rule was aimed at is not there to hang a rule on. */
export class ScopeTargetNotFoundError extends HandledError {
  declare readonly code: "data_privacy_scope_target_not_found";

  constructor(message = "That privacy scope no longer exists.") {
    super("data_privacy_scope_target_not_found", message, { httpStatus: 404 });
    this.name = "ScopeTargetNotFoundError";
  }
}

/** The scope exists, but under a different organization than the project. */
export class ScopeOutsideOrganizationError extends HandledError {
  declare readonly code: "data_privacy_scope_outside_organization";

  constructor() {
    super(
      "data_privacy_scope_outside_organization",
      "That privacy scope belongs to a different organization than this project.",
      { httpStatus: 400 },
    );
    this.name = "ScopeOutsideOrganizationError";
  }
}

/** The caller may not write a rule at the tier they aimed at. */
export class ScopeWriteForbiddenError extends HandledError {
  declare readonly code: "data_privacy_scope_write_forbidden";

  constructor(
    readonly scopeType: string,
    readonly requiredPermission: string,
  ) {
    super(
      "data_privacy_scope_write_forbidden",
      `Changing data privacy at this ${scopeType.toLowerCase()} needs ${requiredPermission}.`,
      { httpStatus: 403, meta: { scopeType, requiredPermission } },
    );
    this.name = "ScopeWriteForbiddenError";
  }
}

/**
 * The rule the caller sent is not a configuration this feature can store.
 * `meta.reason` names the offending pattern, which is the only part the reader
 * can act on — the wire message is the code.
 */
export class InvalidDataPrivacyConfigError extends HandledError {
  declare readonly code: "data_privacy_config_invalid";

  constructor(message: string) {
    super("data_privacy_config_invalid", message, {
      httpStatus: 400,
      meta: { reason: message },
    });
    this.name = "InvalidDataPrivacyConfigError";
  }
}

/**
 * The scope picker offers departments, but a rule cannot be hung on one: this
 * build has no department owner to resolve the rule's organization through.
 * The caller can act — every other tier still takes the same rule.
 */
export class DepartmentScopeOwnershipUnavailableError extends HandledError {
  declare readonly code: "data_privacy_department_scope_unavailable";

  constructor() {
    super(
      "data_privacy_department_scope_unavailable",
      "Data privacy rules cannot be set on a department.",
      { httpStatus: 400 },
    );
    this.name = "DepartmentScopeOwnershipUnavailableError";
  }
}

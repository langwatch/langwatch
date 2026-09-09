import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class CannotImpersonateDeactivatedUserError extends HandledError {
  constructor(userId: string) {
    super("cannot_impersonate_deactivated_user", "Cannot impersonate a deactivated user", {
      httpStatus: 400,
      meta: { userId },
    });
    this.name = "CannotImpersonateDeactivatedUserError";
  }
}

export class CannotImpersonateAdminError extends HandledError {
  constructor(userId: string) {
    super("cannot_impersonate_admin", "Cannot impersonate another admin", {
      httpStatus: 403,
      meta: { userId },
    });
    this.name = "CannotImpersonateAdminError";
  }
}

/**
 * An operator tried to impersonate into an organization that requires a second
 * factor without having set one up. The requirement is about the ACTOR:
 * borrowing access is a higher bar than holding your own, not a way around it.
 */
export class CannotImpersonateWithoutSecondFactorError extends HandledError {
  constructor(detail: string) {
    super("cannot_impersonate_without_second_factor", "cannot_impersonate_without_second_factor", {
      httpStatus: 403,
      fault: "customer",
      reasons: [new Error(detail)],
    });
    this.name = "CannotImpersonateWithoutSecondFactorError";
  }
}

export class UserToImpersonateNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super("user_to_impersonate_not_found", "User to impersonate", userId);
    this.name = "UserToImpersonateNotFoundError";
  }
}

/**
 * "You are not an admin": 404 not 403, generic `not_found`, so the admin
 * surface doesn't confirm its existence to a prober. No identifying
 * fields. Lives in the operations contract since two surfaces must answer identically.
 */
export class AdminSurfaceHiddenError extends HandledError {
  declare readonly code: "not_found";

  constructor() {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer" });
    this.name = "AdminSurfaceHiddenError";
  }
}

/** The cookie is gone, so there is nobody to attach an impersonation to. */
export class AdminSessionExpiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "No active auth session for this admin request", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "AdminSessionExpiredError";
  }
}

/** The back office sent something that was not a JSON object. */
export class AdminMalformedBodyError extends HandledError {
  declare readonly code: "malformed_request";

  constructor() {
    super("malformed_request", "Admin request body must be a JSON object", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AdminMalformedBodyError";
  }
}

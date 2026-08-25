import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class CannotImpersonateDeactivatedUserError extends HandledError {
  constructor(userId: string) {
    super(
      "cannot_impersonate_deactivated_user",
      "Cannot impersonate a deactivated user",
      { httpStatus: 400, meta: { userId } },
    );
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

export class UserToImpersonateNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super("user_to_impersonate_not_found", "User to impersonate", userId);
    this.name = "UserToImpersonateNotFoundError";
  }
}

import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { USER_AVATAR_ALLOWED_MEDIA_TYPES, USER_AVATAR_MAX_BYTES } from "./user.ts";

export type UserAvatarUnreadableReason = "invalid_data_url" | "empty" | "content_mismatch";

export abstract class UserAvatarValidationError extends HandledError {}

export class UserAvatarTooLargeError extends UserAvatarValidationError {
  declare readonly code: "avatar_image_too_large";

  constructor() {
    super("avatar_image_too_large", "Avatar data URL is over the ceiling", {
      meta: { maxBytes: USER_AVATAR_MAX_BYTES },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "UserAvatarTooLargeError";
  }
}

export class UserAvatarTypeUnsupportedError extends UserAvatarValidationError {
  declare readonly code: "avatar_image_type_unsupported";

  constructor(mediaType: string) {
    super(
      "avatar_image_type_unsupported",
      `Avatar declared an unsupported media type: ${mediaType}`,
      {
        meta: { allowed: [...USER_AVATAR_ALLOWED_MEDIA_TYPES] },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "UserAvatarTypeUnsupportedError";
  }
}

export class UserAvatarUnreadableError extends UserAvatarValidationError {
  declare readonly code: "avatar_image_unreadable";

  constructor(reason: UserAvatarUnreadableReason, message: string) {
    super("avatar_image_unreadable", message, {
      meta: { reason },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "UserAvatarUnreadableError";
  }
}

export class UserAvatarRateLimitedError extends HandledError {
  declare readonly code: "avatar_rate_limited";

  constructor() {
    super("avatar_rate_limited", "Too many avatar updates for this user", {
      httpStatus: 429,
      fault: "customer",
    });
    this.name = "UserAvatarRateLimitedError";
  }
}

export class EmailAlreadyRegisteredError extends HandledError {
  declare readonly code: "email_already_registered";

  constructor() {
    super("email_already_registered", "An account with this email already exists", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "EmailAlreadyRegisteredError";
  }
}

/** This deployment federates sign-in, so it mints no password accounts (ADR-027). */
export class UserRegistrationNotAvailableError extends HandledError {
  declare readonly code: "registration_not_available";

  constructor() {
    super(
      "registration_not_available",
      "Direct registration is not available for this sign-in method",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "UserRegistrationNotAvailableError";
  }
}

/** Mirrors the sign-up budget the hosted sign-in path meters, per address. */
export class UserSignupThrottledError extends HandledError {
  declare readonly code: "signup_throttled";

  constructor() {
    super("signup_throttled", "Too many signup attempts from this address", {
      httpStatus: 429,
      fault: "customer",
      retryable: true,
    });
    this.name = "UserSignupThrottledError";
  }
}

/** The password does not live here: the deployment's identity provider holds it. */
export class UserPasswordAuthUnavailableError extends HandledError {
  declare readonly code: "password_auth_not_available";

  constructor() {
    super("password_auth_not_available", "Passwords are not available for this sign-in method", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "UserPasswordAuthUnavailableError";
  }
}

/** A credential outlives the session that set it, so every attempt is metered. */
export class UserPasswordAttemptsThrottledError extends HandledError {
  declare readonly code: "password_attempts_throttled";

  constructor() {
    super("password_attempts_throttled", "Too many password attempts for this account", {
      httpStatus: 429,
      fault: "customer",
      retryable: true,
    });
    this.name = "UserPasswordAttemptsThrottledError";
  }
}

/**
 * Setting a first password fills an empty slot and never replaces a full one:
 * that refusal is what keeps a stolen session from minting a lasting credential.
 */
export class UserPasswordAlreadySetError extends HandledError {
  declare readonly code: "password_already_set";

  constructor() {
    super("password_already_set", "This account already has a password", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "UserPasswordAlreadySetError";
  }
}

/** There is no stored password to replace. */
export class UserPasswordNotSetError extends HandledError {
  declare readonly code: "password_not_set";

  constructor() {
    super("password_not_set", "This account has no password set", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "UserPasswordNotSetError";
  }
}

/** The current password did not match the stored one. */
export class UserPasswordIncorrectError extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", "The current password is incorrect", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "UserPasswordIncorrectError";
  }
}

/** Removing the last sign-in method would leave the account with no way in. */
export class UserLastAuthenticationMethodError extends HandledError {
  declare readonly code: "last_authentication_method";

  constructor() {
    super("last_authentication_method", "Cannot remove the last authentication method", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "UserLastAuthenticationMethodError";
  }
}

export class UserLinkedAccountNotFoundError extends NotFoundError {
  declare readonly code: "linked_account_not_found";

  constructor(accountId: string) {
    super("linked_account_not_found", "Sign-in method", accountId);
    this.name = "UserLinkedAccountNotFoundError";
  }
}

/**
 * Only the identity provider's own database identity has a password this
 * deployment can change; a federated social identity belongs to its upstream.
 */
export class UserFederatedPasswordAccountMissingError extends NotFoundError {
  declare readonly code: "federated_password_account_missing";

  constructor(userId: string) {
    super("federated_password_account_missing", "Password sign-in method", userId);
    this.name = "UserFederatedPasswordAccountMissingError";
  }
}

/** The identity provider refused the change for a reason only an operator can fix. */
export class UserFederatedPasswordChangeUnavailableError extends HandledError {
  declare readonly code: "federated_password_change_unavailable";

  constructor(reason: string) {
    super(
      "federated_password_change_unavailable",
      "The identity provider could not change this password",
      { httpStatus: 502, fault: "platform", meta: { reason } },
    );
    this.name = "UserFederatedPasswordChangeUnavailableError";
  }
}

/** The caller asked for a personal rollup inside an organization they do not belong to. */
export class UserNotOrganizationMemberError extends HandledError {
  declare readonly code: "user_not_in_organization";

  constructor(organizationId: string) {
    super("user_not_in_organization", "Not a member of this organization", {
      httpStatus: 403,
      fault: "customer",
      meta: { organizationId },
    });
    this.name = "UserNotOrganizationMemberError";
  }
}

/** Acting on somebody else's account without standing to. */
export class UserAccountAccessDeniedError extends HandledError {
  declare readonly code: "forbidden";

  constructor() {
    super("forbidden", "This account is not yours to change", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "UserAccountAccessDeniedError";
  }
}

/** The budget-increase request could not be handed to the mail gateway. */
export class UserBudgetRequestNotDeliveredError extends HandledError {
  declare readonly code: "notification_delivery_error";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("notification_delivery_error", "The budget increase request was not sent", {
      httpStatus: 502,
      fault: "platform",
      ...options,
    });
    this.name = "UserBudgetRequestNotDeliveredError";
  }
}

export class UserNotFoundError extends NotFoundError {
  declare readonly code: "user_not_found";

  constructor(userId: string) {
    super("user_not_found", "User", userId, { meta: { userId } });
    this.name = "UserNotFoundError";
  }
}

/**
 * There is no avatar at this URL.
 *
 * ONE code for every refusal `/api/user-avatar` makes, deliberately. The route
 * is readable by any authenticated caller on the platform, so a caller who
 * could tell "no such object" from "that object is not an avatar" from "the
 * avatar's bytes are gone" would be holding an existence oracle over every
 * project's object ids. Nothing renders this body — the consumer is an `<img>`
 * tag reading the status — so there is nothing the three answers would let a
 * customer do differently.
 */
export class UserAvatarNotFoundError extends NotFoundError {
  declare readonly code: "avatar_not_found";

  constructor(id: string) {
    super("avatar_not_found", "Avatar", id);
    this.name = "UserAvatarNotFoundError";
  }
}

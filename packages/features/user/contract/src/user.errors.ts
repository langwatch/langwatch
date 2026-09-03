import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { USER_AVATAR_ALLOWED_MEDIA_TYPES, USER_AVATAR_MAX_BYTES } from "./user";

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

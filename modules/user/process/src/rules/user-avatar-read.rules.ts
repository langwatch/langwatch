import {
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  type UserAvatarObjectRead,
} from "@langwatch/user-contract";

/** An avatar row whose bytes are still in the store. */
export type ServableUserAvatar = Extract<
  NonNullable<UserAvatarObjectRead>,
  { status: "available" }
>;

/**
 * `purpose` says what the object is for and `owner_kind` what produced it; an
 * object carrying one without the other is no avatar, and a row whose bytes
 * are gone has nothing to serve.
 */
export function isServableUserAvatar(read: UserAvatarObjectRead): read is ServableUserAvatar {
  return (
    read !== null &&
    read.status === "available" &&
    read.metadata.purpose === USER_AVATAR_PURPOSE &&
    read.metadata.ownerKind === USER_AVATAR_OWNER_KIND
  );
}

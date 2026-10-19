import { type AvatarRootProps, UserAvatar } from "@langwatch/design-system/avatar";

import { useUserAvatarUrl } from "../../behavior/user/use-user-avatar-url.ts";

/** A person's avatar: a stored photo is resolved to its signed URL here, so elements only draw. */
export function PersonAvatar({
  name,
  image,
  ...rootProps
}: Omit<AvatarRootProps, "children"> & { name?: string | null; image?: string | null }) {
  return <UserAvatar name={name} src={useUserAvatarUrl(image)} {...rootProps} />;
}

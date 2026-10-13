import type { AvatarRootProps } from "@langwatch/design-system/avatar";

import { useUserAvatarUrl } from "../../behavior/user/use-user-avatar-url.ts";
import { RandomColorAvatar } from "../blocks/random-color-avatar.tsx";

/** A member's avatar: a stored photo is resolved to its signed URL here; the block only draws. */
export function MemberAvatar({
  name,
  image,
  ...rootProps
}: AvatarRootProps & { name: string; image?: string | null }) {
  return <RandomColorAvatar name={name} image={useUserAvatarUrl(image)} {...rootProps} />;
}

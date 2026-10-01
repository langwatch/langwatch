import type { AvatarRootProps } from "@langwatch/design-system/avatar";

import { useUserAvatarUrl } from "../../behavior/user/use-user-avatar-url.ts";
import { RandomColorAvatar } from "../elements/random-color-avatar.tsx";

/** A member's avatar: a stored photo resolves to its signed URL here, so the element only draws. */
export function MemberAvatar({
  name,
  image,
  ...rootProps
}: AvatarRootProps & { name: string; image?: string | null }) {
  return <RandomColorAvatar name={name} image={useUserAvatarUrl(image)} {...rootProps} />;
}

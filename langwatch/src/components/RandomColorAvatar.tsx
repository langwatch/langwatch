import type { AvatarRootProps } from "@chakra-ui/react";
import { getColorForString } from "../utils/rotatingColors";
import { UserAvatar } from "./UserAvatar";

/**
 * Person avatar with a deterministic name-hashed background behind the initials
 * fallback. Delegates the image/initials/silhouette fallback chain to
 * {@link UserAvatar}; pass `image` to show an uploaded/SSO photo when available.
 */
export function RandomColorAvatar({
  name,
  image,
  ...props
}: AvatarRootProps & { name: string; image?: string | null }) {
  return (
    <UserAvatar
      name={name}
      image={image}
      color="white"
      background={getColorForString("colors", name).color}
      {...props}
    />
  );
}

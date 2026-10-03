import { type AvatarRootProps, UserAvatar } from "@langwatch/design-system/avatar";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

/**
 * Person avatar with a deterministic name-hashed background behind the initials
 * fallback. Delegates the image/initials/silhouette fallback chain to
 * {@link UserAvatar}; pass `image`, an already resolved URL, to show a photo when available.
 */
export function RandomColorAvatar({
  name,
  image,
  ...props
}: AvatarRootProps & { name: string; image?: string | null }) {
  return (
    <UserAvatar
      name={name}
      src={image}
      color="white"
      background={getColorForString("colors", name).color}
      {...props}
    />
  );
}

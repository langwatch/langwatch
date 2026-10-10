import { type AvatarRootProps, UserAvatar } from "@langwatch/design-system/avatar";
import { getColorPaletteForString } from "@langwatch/design-system/rotating-colors";

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
  const palette = getColorPaletteForString(name);
  return (
    <UserAvatar
      name={name}
      src={image}
      color={`${palette}.fg`}
      background={`${palette}.subtle`}
      {...props}
    />
  );
}

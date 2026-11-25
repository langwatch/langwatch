import { type AvatarRootProps, UserAvatar } from "@langwatch/design-system/avatar";

/**
 * Person avatar: the photo when `image` (an already resolved URL) loads, else initials on the
 * hue hashed from the name, through the design system's {@link UserAvatar}.
 */
export function RandomColorAvatar({
  name,
  image,
  ...props
}: AvatarRootProps & { name: string; image?: string | null }) {
  return <UserAvatar name={name} src={image} colorFromName {...props} />;
}

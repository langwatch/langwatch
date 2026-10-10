/**
 * A FAMILY-LOCAL COPY of `platform/app/src/components/RandomColorAvatar.tsx`
 * (sixteen platform callers keep the original alive); these rows carry a
 * `userImage` an initials-only avatar would drop. Colour: Design System's own `rotating-colors`.
 */

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
  return (
    <UserAvatar
      name={name}
      src={image}
      color={`${getColorPaletteForString(name)}.fg`}
      background={`${getColorPaletteForString(name)}.subtle`}
      {...props}
    />
  );
}

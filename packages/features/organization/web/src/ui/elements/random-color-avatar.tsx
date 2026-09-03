/**
 * A FAMILY-LOCAL COPY of `platform/app/src/components/RandomColorAvatar.tsx`,
 * taken for the reason the RBAC family took `principal-avatar`: sixteen
 * platform callers keep the original alive, and these rows carry a `userImage`
 * that an initials-only avatar would drop. The colour comes from the Design
 * System's own `rotating-colors` rather than from a second copy of the palette.
 */

import type { AvatarRootProps } from "@langwatch/design-system/avatar";
import { getColorForString } from "@langwatch/design-system/rotating-colors";
import { UserAvatar } from "./user-avatar";

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

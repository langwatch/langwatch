import { Avatar, type AvatarRootProps } from "@langwatch/design-system/avatar";
import { useState } from "react";

/**
 * Person avatar with fallback chain: image → initials → silhouette.
 * The onError guard tracks broken URLs so reused components don't stick to stale fallbacks.
 * Spec: specs/settings/user-avatar.feature
 */
export function UserAvatar({
  name,
  image,
  ...rootProps
}: Omit<AvatarRootProps, "children"> & {
  name?: string | null;
  image?: string | null;
}) {
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const showImage = !!image && image !== brokenImageUrl;

  return (
    <Avatar.Root {...rootProps}>
      {showImage ? <Avatar.Image src={image!} onError={() => setBrokenImageUrl(image!)} /> : null}
      <Avatar.Fallback name={name ?? undefined} />
    </Avatar.Root>
  );
}

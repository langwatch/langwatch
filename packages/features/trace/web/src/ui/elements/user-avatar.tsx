import { useState } from "react";
import { Avatar, type AvatarRootProps } from "@langwatch/design-system/avatar";

/**
 * Canonical person avatar: renders the uploaded/SSO `image` when present and falls back to the initials of
 * `name`, then a silhouette when neither is set — the single fallback chain every person-avatar surface shares.
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

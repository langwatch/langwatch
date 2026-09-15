/**
 * Header avatar button. onError tracks broken URL, not boolean, so new photos
 * mid-session don't get stuck on old failures. Spec: specs/settings/user-avatar.feature
 */

import { Avatar, type AvatarRootProps } from "@langwatch/design-system/avatar";
import { useState } from "react";

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
      {showImage ? <Avatar.Image src={image} onError={() => setBrokenImageUrl(image)} /> : null}
      <Avatar.Fallback name={name ?? void 0} />
    </Avatar.Root>
  );
}

/**
 * The person in the header's avatar button.
 *
 * Moved from `platform/app/src/components/UserAvatar.tsx` as it stood. The
 * `onError` guard tracks the BROKEN URL rather than a bare boolean, so a new
 * photo mid-session is not latched to the fallback by the old one's failure.
 *
 * Spec: specs/settings/user-avatar.feature
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

/**
 * A FAMILY-LOCAL COPY of `platform/app/src/components/UserAvatar.tsx`, which
 * sixteen platform surfaces still render and the deletes-only ruling forbids
 * repointing. `@langwatch/trace-web` carries the same copy for the same reason;
 * this is the second, byte for byte.
 */

import { Avatar, type AvatarRootProps } from "@langwatch/design-system/avatar";
import { useState } from "react";

/** Person avatar: image → initials → silhouette; tracks broken URLs for reuse. */
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

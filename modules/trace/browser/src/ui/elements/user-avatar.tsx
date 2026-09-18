import { useState } from "react";
import { Avatar, type AvatarRootProps } from "@langwatch/design-system/avatar";

/**
 * Person avatar: image → initials → silhouette. Single fallback chain shared.
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

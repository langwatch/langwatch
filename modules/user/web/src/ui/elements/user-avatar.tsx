import { Avatar, type AvatarRootProps } from "@chakra-ui/react";
import { useState } from "react";

/**
 * Person avatar with fallback chain: image -> initials -> silhouette.
 * Tracks broken URLs to refresh on image changes.
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
      {showImage ? <Avatar.Image src={image} onError={() => setBrokenImageUrl(image)} /> : null}
      <Avatar.Fallback name={name ?? undefined} />
    </Avatar.Root>
  );
}

/**
 * Reviewer avatar: photo or initials with name-based background color.
 * Local copy (see platform/app/src/components/RandomColorAvatar.tsx).
 */

import { Avatar, type AvatarRootProps } from "@chakra-ui/react";
import { getColorForString } from "@langwatch/design-system/rotating-colors";
import { useState } from "react";

export function ReviewerAvatar({
  name,
  image,
  ...rootProps
}: Omit<AvatarRootProps, "children"> & {
  name: string;
  image?: string | null;
}) {
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const showImage = !!image && image !== brokenImageUrl;

  return (
    <Avatar.Root color="white" background={getColorForString("colors", name).color} {...rootProps}>
      {showImage && image ? (
        <Avatar.Image src={image} onError={() => setBrokenImageUrl(image)} />
      ) : null}
      <Avatar.Fallback name={name} />
    </Avatar.Root>
  );
}

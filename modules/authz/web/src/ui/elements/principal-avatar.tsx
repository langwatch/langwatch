// Member avatar; family-local copy; broken-image guard tracks URL not boolean.

import { Avatar, type AvatarRootProps } from "@chakra-ui/react";
import { getColorForString } from "@langwatch/design-system/rotating-colors";
import { useState } from "react";

export function PrincipalAvatar({
  id,
  name,
  image,
  ...rootProps
}: Omit<AvatarRootProps, "children"> & {
  /** What the colour is hashed from, so one person is one colour everywhere. */
  id: string;
  name: string;
  image?: string | null;
}) {
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const showImage = !!image && image !== brokenImageUrl;
  const colour = getColorForString("colors", name);

  return (
    <Avatar.Root color="white" background={colour.color} data-principal={id} {...rootProps}>
      {showImage && image ? (
        <Avatar.Image src={image} onError={() => setBrokenImageUrl(image)} />
      ) : null}
      <Avatar.Fallback name={name} />
    </Avatar.Root>
  );
}

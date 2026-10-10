// Member avatar; family-local copy; broken-image guard tracks URL not boolean.

import { Avatar } from "@langwatch/design-system/avatar";
import { type AvatarRootProps } from "@langwatch/design-system/primitives";
import { getColorPaletteForString } from "@langwatch/design-system/rotating-colors";
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
  const colour = getColorPaletteForString(name);

  return (
    <Avatar.Root
      color={`${colour}.fg`}
      background={`${colour}.subtle`}
      data-principal={id}
      {...rootProps}
    >
      {showImage && image ? (
        <Avatar.Image src={image} onError={() => setBrokenImageUrl(image)} />
      ) : null}
      <Avatar.Fallback name={name} />
    </Avatar.Root>
  );
}

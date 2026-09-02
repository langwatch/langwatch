/**
 * A member's face on the bindings audit: their photo when there is one, their
 * initials when there is not.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/RandomColorAvatar.tsx`
 * and the `UserAvatar` beneath it, which between them keep sixteen callers in
 * `platform/app` and so did not travel. The Design System publishes no avatar,
 * and the automation family's `ParticipantAvatar` renders initials only — this
 * page's rows carry `userImage`, so the photo half is needed here.
 *
 * The broken-image guard tracks the URL rather than a boolean, for the reason
 * the original states: latching a boolean means a row reused for a different
 * person keeps the previous person's fallback.
 */

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

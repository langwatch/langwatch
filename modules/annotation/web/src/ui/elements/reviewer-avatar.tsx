/**
 * A reviewer's face: their photo when there is one, their initials when there
 * is not, on a background hashed from their name.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/RandomColorAvatar.tsx`
 * and the `UserAvatar` beneath it, which between them keep sixteen callers in
 * `platform/app` and so did not travel. The Design System publishes no avatar,
 * and the automation family's `ParticipantAvatar` renders initials only — these
 * rows, the queue members and the participants picker all carry `image`, so the
 * photo half is needed here. The same copy `@langwatch/authz-web` took, hashed
 * on the name rather than an id because that is what the annotation surfaces
 * hash on today and one person has to be one colour across all of them.
 *
 * The broken-image guard tracks the URL rather than a boolean: latching a
 * boolean means a row reused for a different person keeps the previous person's
 * fallback.
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

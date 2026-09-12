// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A family-local copy of `platform/app/src/components/UserAvatar.tsx` — every
 * feature-web package that needs it keeps its own.
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
      {showImage ? (
        <Avatar.Image src={image!} onError={() => setBrokenImageUrl(image!)} />
      ) : null}
      <Avatar.Fallback name={name ?? undefined} />
    </Avatar.Root>
  );
}

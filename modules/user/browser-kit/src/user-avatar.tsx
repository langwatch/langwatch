/**
 * Person avatar: image, then initials. A stored avatar loads from a signed URL
 * minted for its reference; any other image is used as it stands. A pending or
 * failed mint falls back to the initials. Spec: specs/settings/user-avatar.feature
 */
import { Avatar, type AvatarRootProps } from "@langwatch/design-system/avatar";
import { useState } from "react";

import { userApi } from "./user-api.ts";

const STORED_AVATAR = /^\/api\/user-avatar\/([^/]+)\/([^/?#]+)$/;

/** The URL lapses after 15 minutes; ask again before that. */
const MINT_STALE_MS = 10 * 60_000;

/** Tracks the broken URL, not a flag, so a new photo mid-session is not stuck on an old failure. */
function AvatarPhoto({ src }: { src: string | null }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  if (!src || src === brokenUrl) return null;
  return <Avatar.Image src={src} onError={() => setBrokenUrl(src)} />;
}

function StoredAvatarPhoto({
  projectId,
  userAvatarId,
}: {
  projectId: string;
  userAvatarId: string;
}) {
  const mint = userApi.user.getAvatarUrl.useQuery(
    { projectId, userAvatarId },
    { staleTime: MINT_STALE_MS, retry: false, refetchOnWindowFocus: false },
  );
  return <AvatarPhoto src={mint.data?.url ?? null} />;
}

export function UserAvatar({
  name,
  image,
  ...rootProps
}: Omit<AvatarRootProps, "children"> & {
  name?: string | null;
  image?: string | null;
}) {
  const stored = image ? STORED_AVATAR.exec(image) : null;
  const [, projectId, userAvatarId] = stored ?? [];

  return (
    <Avatar.Root {...rootProps}>
      {projectId && userAvatarId ? (
        <StoredAvatarPhoto projectId={projectId} userAvatarId={userAvatarId} />
      ) : (
        <AvatarPhoto src={image ?? null} />
      )}
      <Avatar.Fallback name={name ?? void 0} />
    </Avatar.Root>
  );
}

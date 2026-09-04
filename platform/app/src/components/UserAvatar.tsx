import { useState } from "react";
import { Avatar, type AvatarRootProps } from "~/components/ui/avatar";

/**
 * Canonical person avatar: renders the uploaded/SSO `image` when present and
 * falls back to the initials of `name`, then a silhouette when neither is set —
 * the single fallback chain every person-avatar surface shares.
 *
 * The `onError` guard tracks the *broken URL* (not a bare boolean) so that when
 * `image` changes to a new URL — the user uploads a new photo mid-session, or
 * the component is reused across people — a previously-broken image doesn't
 * stay latched to the fallback. Mirrors `PresenceAvatar`, which predates this
 * component and keeps its own copy for its presence-specific styling.
 *
 * Spec: specs/settings/user-avatar.feature
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
      {showImage ? (
        <Avatar.Image src={image!} onError={() => setBrokenImageUrl(image!)} />
      ) : null}
      <Avatar.Fallback name={name ?? undefined} />
    </Avatar.Root>
  );
}

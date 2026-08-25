import type { PresenceSession, PresenceUser } from "@langwatch/presence-contract";
import { getColorForString } from "~/utils/rotatingColors";

/** Display name used as the seed for avatar colours and tooltip labels. */
export function presenceUserDisplayName(user: PresenceUser): string {
  return user.name ?? "Someone";
}

/** Stable colour token for a presence user, matched to the avatar background. */
export function presenceUserColor(user: PresenceUser): string {
  return getColorForString("colors", presenceUserDisplayName(user)).color;
}

export function presenceDisplayName(session: PresenceSession): string {
  return presenceUserDisplayName(session.user);
}

export function presenceSessionColor(session: PresenceSession): string {
  return presenceUserColor(session.user);
}

import type { PresenceSession, PresenceUser } from "@langwatch/presence-contract";

// Local hash-to-hue helper, mirroring the app's `rotatingColors.colors` set
// and `getColorForString` algorithm (same 8-name order, same sum-of-char-codes
// hash) so avatar/marker colours stay stable for a given display name. Web
// packages don't depend on app-only utils, so this is a package-local
// reimplementation rather than an import — see `@langwatch/experiment-web`'s
// `getColorForString` for the same precedent.
const COLOR_NAMES = [
  "orange",
  "blue",
  "green",
  "yellow",
  "purple",
  "teal",
  "cyan",
  "pink",
] as const;

function colorForString(value: string): { background: string; color: string } {
  let sum = 0;
  for (const char of value) sum += char.charCodeAt(0);
  const name = COLOR_NAMES[sum % COLOR_NAMES.length] ?? "gray";
  return { background: `${name}.subtle`, color: `${name}.emphasized` };
}

/** Display name used as the seed for avatar colours and tooltip labels. */
export function presenceUserDisplayName(user: PresenceUser): string {
  return user.name ?? "Someone";
}

/** Stable colour token for a presence user, matched to the avatar background. */
export function presenceUserColor(user: PresenceUser): string {
  return colorForString(presenceUserDisplayName(user)).color;
}

export function presenceDisplayName(session: PresenceSession): string {
  return presenceUserDisplayName(session.user);
}

export function presenceSessionColor(session: PresenceSession): string {
  return presenceUserColor(session.user);
}

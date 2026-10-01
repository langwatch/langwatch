import type { PresenceSession, PresenceUser } from "@langwatch/presence-contract";

// Local reimplementation of the app's `getColorForString` algorithm keeps
// avatar colours stable without importing app-only utilities. See
// `@langwatch/experiment-browser`'s `getColorForString` for the same precedent.
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

export function presenceUserDisplayName(user: PresenceUser): string {
  return user.name ?? "Someone";
}

export function presenceUserColor(user: PresenceUser): string {
  return colorForString(presenceUserDisplayName(user)).color;
}

export function presenceDisplayName(session: PresenceSession): string {
  return presenceUserDisplayName(session.user);
}

export function presenceSessionColor(session: PresenceSession): string {
  return presenceUserColor(session.user);
}

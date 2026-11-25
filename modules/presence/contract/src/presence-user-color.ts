import type { PresenceSession, PresenceUser } from "./presence.ts";

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

/** What a presence component draws for one peer, so it needs no knowledge of a session. */
export interface PresencePeerView {
  sessionId: string;
  displayName: string;
  color: string;
  image: string | null;
  /** One line saying where the peer is, for a tooltip. */
  detail: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function describePresence(session: PresenceSession, displayName: string): string {
  const parts: string[] = [displayName];
  const { route, view } = session.location;

  if (route.traceId) {
    parts.push(`trace ${shortId(route.traceId)}`);
  } else if (route.conversationId) {
    parts.push(`conversation ${shortId(route.conversationId)}`);
  } else {
    parts.push(`browsing ${session.location.lens}`);
  }

  if (view?.mode && view.mode !== "trace") parts.push(view.mode);
  if (view?.panel) parts.push(view.panel);
  if (view?.tab) parts.push(view.tab);

  return parts.join(" · ");
}

export function presencePeerView(session: PresenceSession): PresencePeerView {
  const displayName = presenceDisplayName(session);
  return {
    sessionId: session.sessionId,
    displayName,
    color: presenceSessionColor(session),
    image: session.user.image ?? null,
    detail: describePresence(session, displayName),
  };
}

import type { BrowserSession, BrowserSessionResolution } from "@langwatch/auth-contract";

/** The session `GET /api/auth/session` publishes, field for field. */
export type AuthSessionPollDocument = Readonly<{
  session: Readonly<{ expiresAt: string }>;
  user: BrowserSession["user"];
}>;

/** The browser's own session poll: the session's document, or null for an anonymous caller. */
export type AuthSessionPoll = Readonly<{ document: AuthSessionPollDocument | null }>;

/** A resolved browser session as the poll publishes it. */
export function sessionPollOf(resolution: BrowserSessionResolution): AuthSessionPoll {
  if (resolution.kind === "anonymous") return { document: null };
  const { session } = resolution;

  return {
    document: {
      session: { expiresAt: session.expires },
      user: session.user,
    },
  };
}

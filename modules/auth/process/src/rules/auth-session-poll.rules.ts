import type { BrowserSession, BrowserSessionResolution } from "@langwatch/auth-contract";

import type { QueryCacheKeyOwner } from "./query-cache-key.rules.ts";

/** The session `GET /api/auth/session` publishes, field for field. */
export type AuthSessionPollDocument = Readonly<{
  session: Readonly<{ expiresAt: string }>;
  user: BrowserSession["user"];
  /** The keys this user's browser seals its mirrored reads under, this epoch's and the last. */
  cacheKey: string;
  previousCacheKey: string;
}>;

/** The browser's own session poll: the session's document, or null for an anonymous caller. */
export type AuthSessionPoll = Readonly<{ document: AuthSessionPollDocument | null }>;

/** A resolved browser session as the poll publishes it, with its keys for `epoch` and the last. */
export function sessionPollOf({
  resolution,
  epoch,
  deriveCacheKey,
}: {
  resolution: BrowserSessionResolution;
  epoch: number;
  deriveCacheKey: (input: QueryCacheKeyOwner & { epoch: number }) => string;
}): AuthSessionPoll {
  if (resolution.kind === "anonymous") return { document: null };
  const { session } = resolution;
  const owner = { userId: session.user.id, impersonatorId: session.user.impersonator?.id };

  return {
    document: {
      session: { expiresAt: session.expires },
      user: session.user,
      cacheKey: deriveCacheKey({ ...owner, epoch }),
      previousCacheKey: deriveCacheKey({ ...owner, epoch: epoch - 1 }),
    },
  };
}

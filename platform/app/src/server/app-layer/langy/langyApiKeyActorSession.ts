/**
 * Builds the acting `Session` for a key-initiated Langy turn.
 *
 * The turn service takes a `Session`, not a bare user id, and reads more than
 * the id off it: `LangyCredentialService.mintSessionKey` scopes the per-turn
 * `sk-lw-*` key to `session.user.id` (ADR-047), and `resolveActingGithubLogin`
 * derives the `Co-authored-by` trailer from `session.user.name` / `.email`.
 *
 * So the session is LOADED, never synthesised. A hand-built session carrying a
 * placeholder name would mint a correctly-scoped key but sign the worker's
 * commits with an identity that belongs to nobody — attribution that reads as
 * authoritative and is not. If the owning user row is gone (deleted account,
 * key not yet reaped), we refuse rather than fall back to a stand-in actor.
 *
 * `expires` is set to now, not a future timestamp: nothing downstream renews or
 * revalidates it, and stamping a fresh hour onto a credential-derived session
 * would claim a login freshness that never happened.
 */

import type { PrismaClient } from "@prisma/client";
import type { Session } from "~/server/auth";

/** Why an owning user could not be turned into an acting session. */
export type LangyActorDenialReason = "actor-missing";

export type LangyActorResolution =
  | { ok: true; session: Session }
  | { ok: false; reason: LangyActorDenialReason; message: string };

/**
 * Load the key owner and present them as the acting session.
 *
 * `userId` must come from the resolved credential (`resolved.userId`), never
 * from a request payload — the whole point of the identity bridge is that the
 * actor is a property of the key, not something the caller can assert.
 */
export async function resolveLangyActorSession({
  prisma,
  userId,
  now,
}: {
  prisma: Pick<PrismaClient, "user">;
  userId: string;
  now: Date;
}): Promise<LangyActorResolution> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });

  if (!user) {
    return {
      ok: false,
      reason: "actor-missing",
      message:
        "The user this API key belongs to no longer exists. Langy turns are attributed to a real person, so this key cannot start one.",
    };
  }

  return {
    ok: true,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      expires: now.toISOString(),
    },
  };
}

/**
 * Builds the acting `Session` for a key-initiated Langy turn.
 *
 * The turn service takes a `Session`, not a bare id, and reads more than the
 * id off it: `LangyCredentialService.mintSessionKey` scopes the per-turn
 * `sk-lw-*` key to `session.user.id` (ADR-047), and `resolveActingGithubLogin`
 * derives the `Co-authored-by` trailer from `session.user.name` / `.email`.
 *
 * So the session is LOADED, never synthesised. A hand-built session carrying a
 * placeholder name would mint a correctly-scoped key but sign the worker's
 * commits with an identity that belongs to nobody — attribution that reads as
 * authoritative and is not. If the row behind the actor is gone (deleted
 * account, revoked key not yet reaped), we refuse rather than fall back to a
 * stand-in actor.
 *
 * A service key acts as itself, so its session names the key: the id is the
 * key's id and the display name is the key's name, with no email. Whatever the
 * worker signs is then attributed to the credential that started the turn,
 * which is the truthful record.
 *
 * `expires` is set to now, not a future timestamp: nothing downstream renews or
 * revalidates it, and stamping a fresh hour onto a credential-derived session
 * would claim a login freshness that never happened.
 */

import type { Session } from "~/server/auth";
import type { LangyActor } from "./langyApiKeyIdentity";

/** Why an actor could not be turned into an acting session. */
export type LangyActorDenialReason = "actor-missing";

/**
 * The two reads this resolver makes, as a type.
 *
 * Narrower than `Pick<PrismaClient, "user" | "apiKey">` on purpose: a test
 * double for the full delegates can only be produced by casting it into place,
 * and a cast is exactly the thing that stops failing when the contract moves.
 * Declaring each call means the double satisfies the parameter honestly, while
 * the real `PrismaClient` still has to remain assignable where `langy-api.ts`
 * passes the real client in — that call site is what keeps this honest, and it
 * fails the typecheck if a delegate's shape moves. So this narrows what the
 * resolver may use, not what it is checked against.
 */
export type LangyActorReader = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; email: true; image: true };
    }): Promise<{
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
    } | null>;
  };
  apiKey: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true };
    }): Promise<{ id: string; name: string } | null>;
  };
};

export type LangyActorResolution =
  | { ok: true; session: Session }
  | { ok: false; reason: LangyActorDenialReason; message: string };

/**
 * Load the actor and present it as the acting session.
 *
 * `actor` must come from the resolved credential (the identity bridge), never
 * from a request payload — the whole point of the bridge is that the actor is
 * a property of the key, not something the caller can assert.
 */
export async function resolveLangyActorSession({
  prisma,
  actor,
  now,
}: {
  prisma: LangyActorReader;
  actor: LangyActor;
  now: Date;
}): Promise<LangyActorResolution> {
  if (actor.type === "apiKey") {
    const key = await prisma.apiKey.findUnique({
      where: { id: actor.id },
      select: { id: true, name: true },
    });

    if (!key) {
      return {
        ok: false,
        reason: "actor-missing",
        message:
          "The service key this request was authenticated with no longer exists. Langy turns are attributed to a real principal, so this key cannot start one.",
      };
    }

    return {
      ok: true,
      session: {
        user: { id: key.id, name: key.name, email: null, image: null },
        expires: now.toISOString(),
      },
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, name: true, email: true, image: true },
  });

  if (!user) {
    return {
      ok: false,
      reason: "actor-missing",
      message:
        "The user this API key belongs to no longer exists. Langy turns are attributed to a real principal, so this key cannot start one.",
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

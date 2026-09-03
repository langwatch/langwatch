/**
 * The person a key-authenticated Langy turn is attributed to.
 *
 * A turn runs as a HUMAN, never as a key: the worker's credentials are minted
 * from the acting user and the conversation is filed under them, so a key
 * whose owner no longer exists cannot start one.
 *
 * The session this builds is {@link LangyCredentialSession} — the three fields
 * the Langy application actually reads — rather than the browser session the
 * platform route used to synthesize. The browser session carried an `expires`
 * stamped with the current instant, which said nothing: nothing downstream
 * read it, and a synthesized expiry that is always "now" is a field that can
 * only mislead.
 */
import type { LangyCredentialSession } from "@langwatch/langy-contract";

export type LangyActorUserReader = {
  user: {
    findUnique(input: {
      where: { id: string };
      select: { id: true; name: true; email: true };
    }): Promise<{
      id: string;
      name: string | null;
      email: string | null;
    } | null>;
  };
};

export type LangyActorResolution =
  | { ok: true; session: LangyCredentialSession }
  | { ok: false; reason: "actor-missing"; message: string };

export async function resolveLangyActorSession(input: {
  users: LangyActorUserReader;
  userId: string;
}): Promise<LangyActorResolution> {
  const user = await input.users.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true },
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
      },
    },
  };
}

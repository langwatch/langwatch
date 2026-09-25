import { setSessionCookie } from "better-auth/cookies";

/**
 * better-auth's session store, as minting needs it — the two calls actually
 * made, so this does not track its adapter type version to version, and so a
 * handler can be driven by a test without the endpoint machinery around it.
 */
export interface SessionMintingAdapter {
  findUserById: (id: string) => Promise<unknown>;
  createSession: (userId: string) => Promise<unknown>;
}

/**
 * The half of an endpoint context minting reads. Each caller's own context
 * type extends this and adds what it reads for itself.
 *
 * The adapter is optional because one of the two callers is an after-hook,
 * where better-auth hands the hook a context it may not have finished
 * populating. A context with no adapter mints nothing, which is the same
 * answer as an adapter that finds no user.
 */
export interface SessionMintingContext {
  context?: { internalAdapter?: SessionMintingAdapter };
}

/**
 * Opening a session for a named person, and setting the cookie that carries
 * it — the sequence `findUserById` → `createSession` → `setSessionCookie`.
 *
 * ONE class because two doors mint the first session of an account's life and
 * neither of them is a sign-in: the sign-up confirmation link (ADR-117 §6),
 * and the after-hook of a completed password reset (D13). Both proved the
 * address, both hold a user id and no credential, and both used to spell the
 * same three calls and the same structural context type for themselves.
 *
 * Nothing here decides WHETHER a session is owed — that is the caller's, and
 * it is the whole of what the two callers do differently. This only answers
 * whether one could be opened, and it raises what it cannot do: a session
 * store that is down is a failure each caller degrades in its own words.
 *
 * With ONE refusal, which is not that decision: an account holding a second
 * factor never gets a session from here. See {@link holdsSecondFactor}.
 */
export class BetterAuthSessionMinter {
  /**
   * Opens the session and sets the cookie. Answers false, having done
   * nothing, when the context carries no adapter, when the account has gone,
   * when the account holds a second factor, or when the store declined to
   * make a session.
   */
  async mint({
    ctx,
    userId,
  }: {
    ctx: SessionMintingContext;
    userId: string;
  }): Promise<boolean> {
    const adapter = ctx.context?.internalAdapter;
    if (!adapter) return false;

    const user = await adapter.findUserById(userId);
    if (!user) return false;
    if (holdsSecondFactor(user)) return false;

    const session = await adapter.createSession(userId);
    if (!session) return false;

    await setSessionCookie(ctx as never, { session, user } as never);
    return true;
  }
}

/**
 * Whether the account has finished enrolling a second factor.
 *
 * WHY MINTING STOPS HERE. Both doors open a session on the strength of a
 * proved ADDRESS, and an address is exactly the thing a second factor exists
 * to stop being sufficient. The plugin challenges `/sign-in/*`, and these two
 * doors are not sign-in: they call `createSession` on the store directly, so
 * no challenge is reachable from here — not by a matcher this could be added
 * to, but by construction.
 *
 * Left unguarded, a password-reset link is a full session on an account with
 * two-step verification, skipping the code the same person would have been
 * asked for a second earlier at the sign-in screen. It also satisfies every
 * organization that requires a second factor, because the requirement is met
 * by enrolment rather than by anything the session proved.
 *
 * Refusing costs that person one screen: the reset succeeded, and they sign
 * in — where they are challenged. Both callers already treat a false answer
 * as "offer the way in", so nothing else has to change.
 *
 * The sign-up confirmation door cannot reach this today, since a newborn
 * account has enrolled nothing. It is guarded anyway: the invariant belongs
 * to minting, not to how each caller happens to be reached now.
 *
 * `User.twoFactorEnabled` is the two-factor plugin's own column and the one
 * answer to "has this account finished a setup". Read structurally, like the
 * rest of this file, so it does not track the adapter's type version to
 * version.
 */
function holdsSecondFactor(user: unknown): boolean {
  return (
    typeof user === "object" &&
    user !== null &&
    (user as { twoFactorEnabled?: unknown }).twoFactorEnabled === true
  );
}

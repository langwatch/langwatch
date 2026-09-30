import {
  boundsNothing,
  lastSeenWriteIntervalMs,
  type SessionBound,
  type SessionBoundVerdict,
  sessionBoundVerdict,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:session-bound");

/**
 * Bounding how long a signed-in browser session lasts (GAC-10).
 * Spec: specs/identity/org-session-lifetime.feature.
 *
 * The arithmetic lives in `@langwatch/identity`'s `session-bound`. This
 * service is where it meets a real session: which bound applies to this
 * person, what counts as "last used" when nothing finer was ever recorded,
 * and - when the session is past its window - ENDING it rather than merely
 * refusing this one request. A session refused in one place and honoured in
 * another has not ended.
 *
 * WHERE IT IS ASKED. `getServerAuthSession`, which every surface already goes
 * through to turn a session into an identity, and which already reads the
 * session row on each authenticated request in order to fail closed on a
 * revoked one. Enforcing the window there costs no extra round trip. A check
 * that lived in one page's loader would not be a session policy at all.
 */

/** The session as this service needs to see it. */
export interface BoundableSession {
  id: string;
  token: string;
  userId: string;
  /** When the sign-in that minted it happened. */
  createdAt: Date;
  /** Our own stamp, null on any session that has never been under a window. */
  lastSeenAt: Date | null;
  /**
   * better-auth's own roll, which happens once per `updateAge` - a day.
   * Stands in when `lastSeenAt` is null, and is conservative in the only
   * direction that matters: it is never EARLIER than the real last use, so it
   * can judge a session more active than it was but never less.
   */
  updatedAt: Date;
}

export interface SessionBoundPolicyPort {
  /** The strictest bound among the organizations this person belongs to. */
  forUser(args: { userId: string }): Promise<SessionBound>;
  /**
   * The strictest bound anybody on this installation has set.
   *
   * The early-out. When nobody has set one, this feature costs a signed-in
   * request nothing at all - no policy lookup, no stamp, no extra read.
   */
  installationWide(): Promise<SessionBound>;
}

/** Recording that a session was used. */
export interface SessionActivityPort {
  touch(args: { sessionId: string; at: Date }): Promise<void>;
}

/** Ending a session for good - the row and the cached copy together. */
export interface SessionEndPort {
  end(args: { token: string; userId: string }): Promise<void>;
}

export interface SessionBoundDeps {
  policy: SessionBoundPolicyPort;
  activity: SessionActivityPort;
  ending: SessionEndPort;
  now: () => Date;
}

export class SessionBoundService {
  constructor(private readonly deps: SessionBoundDeps) {}

  /**
   * Whether this session may still be used, ending it if not.
   *
   * Returns the verdict rather than throwing, because the caller is the seam
   * that turns a session into an identity and its answer for "no" is `null`,
   * not an exception. The reason travels with it so the sign-in screen can
   * say why somebody is back on it - being signed out by your organization's
   * own policy is an expected outcome, and presenting it as a failure teaches
   * administrators that their own setting is broken.
   */
  async enforce({
    session,
  }: {
    session: BoundableSession;
  }): Promise<SessionBoundVerdict> {
    const bound = await this.boundFor({ userId: session.userId });
    if (bound === null) return { withinBound: true };

    const now = this.deps.now();
    const lastSeenAt = session.lastSeenAt ?? session.updatedAt;
    const verdict = sessionBoundVerdict({
      bound,
      createdAt: session.createdAt,
      lastSeenAt,
      now,
    });

    if (!verdict.withinBound) {
      await this.end({ session, reason: verdict.reason });
      return verdict;
    }

    await this.touchIfDue({ session, bound, lastSeenAt, now });
    return verdict;
  }

  /**
   * The bound that governs this session, or null when nothing does.
   *
   * Asked of the installation first so a deployment that has never turned
   * this on stops here, before any per-person lookup.
   */
  private async boundFor({
    userId,
  }: {
    userId: string;
  }): Promise<SessionBound | null> {
    const anybody = await this.deps.policy.installationWide();
    if (boundsNothing(anybody)) return null;

    const bound = await this.deps.policy.forUser({ userId });
    return boundsNothing(bound) ? null : bound;
  }

  /**
   * Ends the session, and never lets that failure sign somebody in.
   *
   * A destroy that throws must not become a session that survived its own
   * window: the caller is told the session is over either way, and the row is
   * retried on the next request, which there will be one of because the
   * browser still holds the cookie.
   */
  private async end({
    session,
    reason,
  }: {
    session: BoundableSession;
    reason: string;
  }): Promise<void> {
    try {
      await this.deps.ending.end({
        token: session.token,
        userId: session.userId,
      });
    } catch (error) {
      logger.warn(
        { error, sessionId: session.id, reason },
        "could not end a session that is past its organization's window; it is refused to the caller regardless and will be retried on the next request",
      );
    }
  }

  /**
   * Records activity, at most once per quarter-window.
   *
   * Writing on every request would tax every signed-in request in the product
   * for a setting almost nobody has turned on. A quarter-window keeps the
   * stamp fresh enough that the effective timeout lands between the
   * configured value and a quarter more.
   *
   * Its failure is swallowed on purpose. A stamp that did not get written
   * makes the session look slightly more idle than it is, which ends it
   * early at worst; a stamp whose failure ended the request would turn a
   * write blip into a sign-out.
   */
  private async touchIfDue({
    session,
    bound,
    lastSeenAt,
    now,
  }: {
    session: BoundableSession;
    bound: SessionBound;
    lastSeenAt: Date;
    now: Date;
  }): Promise<void> {
    const interval = lastSeenWriteIntervalMs(bound);
    if (interval <= 0) return;
    if (now.getTime() - lastSeenAt.getTime() < interval) return;

    try {
      await this.deps.activity.touch({ sessionId: session.id, at: now });
    } catch (error) {
      logger.warn(
        { error, sessionId: session.id },
        "could not record that a session was used; it may be judged idle sooner than it should be",
      );
    }
  }
}

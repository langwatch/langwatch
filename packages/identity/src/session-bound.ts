/**
 * Bounding how long a signed-in browser session lasts (GAC-10).
 * Spec: specs/identity/org-session-lifetime.feature.
 *
 * TWO NUMBERS, NOT ONE. "Valid for one hour and refreshed every hour"
 * describes a rolling window: activity keeps you in, an idle hour puts you
 * out. That is the IDLE timeout. The second number - a ceiling from the
 * moment of sign-in that no activity extends - exists beside it because a
 * session kept alive forever by a page that polls is not bounded at all, and
 * because an auditor reading "valid for one hour" literally will ask for it.
 *
 * NOT `maxSessionDurationDays`, which bounds CLI and device sessions and is
 * enforced when the CLI refreshes. Two surfaces, two lifetimes, two decisions
 * an administrator makes separately - an hour-long CLI session would break
 * every scheduled job our customers run, and nobody setting a browser idle
 * timeout is asking for that.
 *
 * Pure, like `account-lockout`. Reading the policy, reading the session and
 * ending it are somebody else's job; this is the arithmetic, so "idle for
 * seventy minutes under a sixty minute window" is a test rather than a wait.
 */

/** How long an organization lets a browser session last. */
export interface SessionBound {
  /**
   * Minutes a session may sit idle before it ends. ZERO MEANS NO IDLE
   * TIMEOUT, and is the default every organization keeps until an
   * administrator sets it.
   */
  idleTimeoutMinutes: number;
  /**
   * Minutes from sign-in after which the session ends whatever the person is
   * doing. Zero means no ceiling.
   */
  maxLifetimeMinutes: number;
}

/** What an organization that has never configured this asks: nothing. */
export const NO_SESSION_BOUND: SessionBound = {
  idleTimeoutMinutes: 0,
  maxLifetimeMinutes: 0,
};

/**
 * The tightest bound among the organizations a person belongs to.
 *
 * There is ONE browser session. A person may belong to several
 * organizations, and a session is a single object with a single expiry, so
 * there is no honest way to have it be two lengths at once: the tightest
 * window wins and bounds the whole session, personal workspace included.
 *
 * This is the one place this feature is less kind than the two-step
 * requirement next door, which deliberately strands nobody's personal
 * workspace. It is a consequence of what a session is rather than a choice,
 * and it is stated in the spec so administrators meet it there rather than in
 * a support ticket.
 *
 * Zero never wins over a real number, in either field and independently: an
 * organization that sets only an idle timeout does not thereby remove another
 * organization's ceiling.
 */
export function strictestSessionBound(
  bounds: readonly SessionBound[],
): SessionBound {
  const tightest = (pick: (bound: SessionBound) => number): number => {
    const set = bounds.map(pick).filter((minutes) => minutes > 0);
    return set.length === 0 ? 0 : Math.min(...set);
  };
  return {
    idleTimeoutMinutes: tightest((bound) => bound.idleTimeoutMinutes),
    maxLifetimeMinutes: tightest((bound) => bound.maxLifetimeMinutes),
  };
}

/** Whether a bound asks anything at all, which is what lets callers skip work. */
export function boundsNothing(bound: SessionBound): boolean {
  return bound.idleTimeoutMinutes <= 0 && bound.maxLifetimeMinutes <= 0;
}

/** Why a session ended, in the only two ways it can end here. */
export type SessionEndedReason = "idle" | "max_lifetime";

/** Whether this session is still within its organization's bound. */
export type SessionBoundVerdict =
  | { withinBound: true }
  | { withinBound: false; reason: SessionEndedReason };

/**
 * Whether a session is still allowed to exist.
 *
 * `lastSeenAt` is when the session was last used. Where nothing finer is
 * recorded, the caller passes the session's own last write - see the app
 * layer for why that is enough and where it is not.
 */
export function sessionBoundVerdict({
  bound,
  createdAt,
  lastSeenAt,
  now,
}: {
  bound: SessionBound;
  /** When the sign-in that minted this session happened. */
  createdAt: Date;
  /** When it was last used. */
  lastSeenAt: Date;
  now: Date;
}): SessionBoundVerdict {
  // The ceiling first: a session past it is over regardless of how active the
  // person has been, and saying "idle" about somebody who has been working
  // for nine hours straight would be a lie in the log as well as on screen.
  if (
    bound.maxLifetimeMinutes > 0 &&
    now.getTime() - createdAt.getTime() >= bound.maxLifetimeMinutes * 60_000
  ) {
    return { withinBound: false, reason: "max_lifetime" };
  }
  if (
    bound.idleTimeoutMinutes > 0 &&
    now.getTime() - lastSeenAt.getTime() >= bound.idleTimeoutMinutes * 60_000
  ) {
    return { withinBound: false, reason: "idle" };
  }
  return { withinBound: true };
}

/**
 * How often the last-seen stamp is worth rewriting, given the window it
 * serves.
 *
 * Writing it on every request would tax every signed-in request in the
 * product for a setting almost nobody has turned on; writing it once a day -
 * which is all better-auth's own session roll does - cannot tell an hour of
 * idleness from a minute of it. A quarter of the window is fine for both: the
 * stamp is never more than a quarter-window stale, so the effective timeout
 * lands between the configured value and a quarter more, and a person under a
 * sixty minute window writes at most once every fifteen minutes.
 *
 * Floored at a minute so a very short window cannot turn into a write per
 * request.
 */
export function lastSeenWriteIntervalMs(bound: SessionBound): number {
  if (bound.idleTimeoutMinutes <= 0) return 0;
  return Math.max(60_000, (bound.idleTimeoutMinutes * 60_000) / 4);
}

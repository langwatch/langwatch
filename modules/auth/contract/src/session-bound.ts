/**
 * Bounding how long a signed-in browser session lasts (GAC-10). Two numbers:
 * an idle window activity rolls, and a ceiling no activity extends.
 * Spec: specs/identity/org-session-lifetime.feature.
 */

import type { Instant } from "@langwatch/time";

/** How long an organization lets a browser session last. */
export interface SessionBound {
  /** Minutes a session may sit idle before it ends. ZERO MEANS NO IDLE
   *  TIMEOUT, and is what an organization keeps until it sets one. */
  idleTimeoutMinutes: number;
  /** Minutes from sign-in after which the session ends whatever the person
   *  is doing. Zero means no ceiling. */
  maxLifetimeMinutes: number;
}

/** What an organization that has never configured this asks: nothing. */
export const NO_SESSION_BOUND: SessionBound = {
  idleTimeoutMinutes: 0,
  maxLifetimeMinutes: 0,
};

/**
 * The tightest bound among a person's organizations. There is ONE session
 * with ONE expiry, so the tightest window bounds all of it, personal
 * workspace included; zero never wins over a real number, field by field.
 */
export function strictestSessionBound(bounds: readonly SessionBound[]): SessionBound {
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
 * Whether a session is still allowed to exist. The ceiling is asked first: a
 * session past it is over however active the person has been, and calling
 * that "idle" would be a lie in the log as well as on the screen.
 */
export function sessionBoundVerdict({
  bound,
  createdAt,
  lastSeenAt,
  now,
}: {
  bound: SessionBound;
  /** When the sign-in that minted this session happened. */
  createdAt: Instant;
  /** When it was last used. */
  lastSeenAt: Instant;
  now: Instant;
}): SessionBoundVerdict {
  if (
    bound.maxLifetimeMinutes > 0 &&
    now.epochMilliseconds - createdAt.epochMilliseconds >= bound.maxLifetimeMinutes * 60_000
  ) {
    return { withinBound: false, reason: "max_lifetime" };
  }

  if (
    bound.idleTimeoutMinutes > 0 &&
    now.epochMilliseconds - lastSeenAt.epochMilliseconds >= bound.idleTimeoutMinutes * 60_000
  ) {
    return { withinBound: false, reason: "idle" };
  }

  return { withinBound: true };
}

/**
 * How often the last-seen stamp is worth rewriting: a quarter-window. Per
 * request taxes every signed-in request for a setting almost nobody set;
 * once a day cannot tell an idle hour from an idle minute.
 */
export function lastSeenWriteIntervalMs(bound: SessionBound): number {
  if (bound.idleTimeoutMinutes <= 0) return 0;

  return Math.max(60_000, (bound.idleTimeoutMinutes * 60_000) / 4);
}

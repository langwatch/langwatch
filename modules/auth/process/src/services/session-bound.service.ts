import {
  boundsNothing,
  lastSeenWriteIntervalMs,
  sessionBoundVerdict,
  strictestSessionBound,
  type SessionBound,
  type SessionBoundVerdict,
} from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { SignInSecuritySettingsRepository } from "../repositories/sign-in-security-settings.repository.ts";

const logger = createLogger("langwatch:auth:session-bound");

/**
 * Bounding how long a signed-in browser session lasts (GAC-10). Asked where a
 * session becomes an identity - every surface goes through it and the row is
 * already read. Spec: specs/identity/org-session-lifetime.feature.
 */

/** The session as this service needs to see it. */
export interface BoundableSession {
  id: string;
  userId: string;
  /** When the sign-in that minted it happened. */
  createdAt: Instant;
  /** Our own stamp, null on any session never under a window. */
  lastSeenAt: Instant | null;
  /** better-auth's own roll, once a day. Stands in when `lastSeenAt` is null
   *  and is never EARLIER than the real last use, so it errs towards keeping
   *  somebody signed in rather than signing them out. */
  updatedAt: Instant;
}

/** Recording that a session was used. */
export interface SessionActivityWriter {
  touch(input: { sessionId: string; at: Instant }): Promise<void>;
}

export interface SessionBoundDeps {
  settings: SignInSecuritySettingsRepository;
  activity: SessionActivityWriter;
  now: () => Instant;
}

export class SessionBoundService {
  static create(deps: SessionBoundDeps): SessionBoundService {
    return new SessionBoundService(deps);
  }

  private constructor(private readonly deps: SessionBoundDeps) {}

  /**
   * Whether this session may still be used. The verdict rather than a throw:
   * the caller's answer for "no" is a null session AND a destroyed row, and
   * being signed out by your own policy is expected, not a failure.
   */
  async enforce({ session }: { session: BoundableSession }): Promise<SessionBoundVerdict> {
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

    if (!verdict.withinBound) return verdict;

    await this.touchIfDue({ session, bound, lastSeenAt, now });

    return verdict;
  }

  /** The bound governing this session, or null when nothing does. Asked of
   *  the installation first, so a deployment that never turned this on stops
   *  before any per-person lookup. */
  private async boundFor({ userId }: { userId: string }): Promise<SessionBound | null> {
    const configured = await this.deps.settings.findConfigured();
    const anybody = strictestSessionBound(configured.map((rule) => rule.sessionBound));
    if (boundsNothing(anybody)) return null;

    const governing = await this.deps.settings.findForUser({ userId });
    const bound = strictestSessionBound(governing.map((rule) => rule.sessionBound));

    return boundsNothing(bound) ? null : bound;
  }

  /**
   * Records activity, at most once per quarter-window. Its failure is
   * swallowed: a stamp that did not get written makes a session look slightly
   * more idle than it is, and a write blip must not become a sign-out.
   */
  private async touchIfDue({
    session,
    bound,
    lastSeenAt,
    now,
  }: {
    session: BoundableSession;
    bound: SessionBound;
    lastSeenAt: Instant;
    now: Instant;
  }): Promise<void> {
    const interval = lastSeenWriteIntervalMs(bound);
    if (interval <= 0) return;
    if (now.epochMilliseconds - lastSeenAt.epochMilliseconds < interval) return;

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

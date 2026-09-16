import { describe, expect, it } from "vitest";
import {
  boundsNothing,
  lastSeenWriteIntervalMs,
  NO_SESSION_BOUND,
  type SessionBound,
  sessionBoundVerdict,
  strictestSessionBound,
} from "../session-bound";

/**
 * The arithmetic behind bounding how long a browser session lasts (GAC-10,
 * specs/identity/org-session-lifetime.feature).
 *
 * "Idle for seventy minutes under a sixty minute window" is seventy minutes
 * of waiting against a real session and one line here, which is why the
 * decision is pure.
 */

const ONE_HOUR_IDLE: SessionBound = {
  idleTimeoutMinutes: 60,
  maxLifetimeMinutes: 0,
};

const SIGNED_IN_AT = new Date("2026-09-16T09:00:00.000Z");
const minutesAfterSignIn = (minutes: number) =>
  new Date(SIGNED_IN_AT.getTime() + minutes * 60_000);

/** The verdict for a session signed in at nine and last used `usedAt`. */
function verdictAt({
  bound,
  lastUsedMinutes,
  nowMinutes,
}: {
  bound: SessionBound;
  lastUsedMinutes: number;
  nowMinutes: number;
}) {
  return sessionBoundVerdict({
    bound,
    createdAt: SIGNED_IN_AT,
    lastSeenAt: minutesAfterSignIn(lastUsedMinutes),
    now: minutesAfterSignIn(nowMinutes),
  });
}

describe("given an organization that has never set a window", () => {
  describe("when somebody leaves their browser for a week", () => {
    /** @scenario "No window means the session behaves as it always has" */
    it("leaves them signed in", () => {
      expect(
        verdictAt({
          bound: NO_SESSION_BOUND,
          lastUsedMinutes: 0,
          nowMinutes: 60 * 24 * 7,
        }),
      ).toEqual({ withinBound: true });
    });

    it("asks nothing, so callers can skip the work entirely", () => {
      // The property that keeps this free for every deployment that has not
      // turned it on: one boolean, and no stamp is ever written.
      expect(boundsNothing(NO_SESSION_BOUND)).toBe(true);
      expect(lastSeenWriteIntervalMs(NO_SESSION_BOUND)).toBe(0);
    });
  });
});

describe("given an organization that ends idle sessions after an hour", () => {
  describe("when the session has sat untouched past the window", () => {
    /** @scenario "An hour of nothing ends the session" */
    it("ends it, and says idling is why", () => {
      expect(
        verdictAt({
          bound: ONE_HOUR_IDLE,
          lastUsedMinutes: 0,
          nowMinutes: 70,
        }),
      ).toEqual({ withinBound: false, reason: "idle" });
    });
  });

  describe("when it is used every half hour all afternoon", () => {
    /** @scenario "Using it keeps it alive" */
    it("never ends it", () => {
      // Five hours of work in half-hour steps. The rolling window is the
      // "refreshed every hour" half of the control: a window that expired
      // regardless of activity would be a maximum session length, which is
      // the other setting entirely.
      for (let elapsed = 30; elapsed <= 300; elapsed += 30) {
        expect(
          verdictAt({
            bound: ONE_HOUR_IDLE,
            lastUsedMinutes: elapsed - 30,
            nowMinutes: elapsed,
          }),
        ).toEqual({ withinBound: true });
      }
    });
  });
});

describe("given an organization that caps a session at eight hours", () => {
  describe("when somebody works straight through it", () => {
    /** @scenario "A maximum length is not extended by activity" */
    it("ends the session anyway, and does not call it idling", () => {
      expect(
        verdictAt({
          bound: { idleTimeoutMinutes: 60, maxLifetimeMinutes: 8 * 60 },
          // Used one minute ago: as active as a session gets.
          lastUsedMinutes: 9 * 60 - 1,
          nowMinutes: 9 * 60,
        }),
      ).toEqual({ withinBound: false, reason: "max_lifetime" });
    });

    it("leaves them alone until the ceiling", () => {
      expect(
        verdictAt({
          bound: { idleTimeoutMinutes: 60, maxLifetimeMinutes: 8 * 60 },
          lastUsedMinutes: 7 * 60,
          nowMinutes: 7 * 60 + 30,
        }),
      ).toEqual({ withinBound: true });
    });
  });
});

describe("given somebody who belongs to more than one organization", () => {
  describe("when one sets a window and the other does not", () => {
    /** @scenario "A member of two organizations is bound by the tighter one" */
    it("bounds the whole session by the tighter one", () => {
      // There is one session and one of him, so the personal workspace is
      // bounded too. Stated here rather than discovered in a support ticket.
      const merged = strictestSessionBound([ONE_HOUR_IDLE, NO_SESSION_BOUND]);

      expect(merged).toEqual({
        idleTimeoutMinutes: 60,
        maxLifetimeMinutes: 0,
      });
      expect(
        sessionBoundVerdict({
          bound: merged,
          createdAt: SIGNED_IN_AT,
          lastSeenAt: SIGNED_IN_AT,
          now: minutesAfterSignIn(70),
        }),
      ).toEqual({ withinBound: false, reason: "idle" });
    });
  });

  describe("when both set windows", () => {
    it("takes the tighter of each number independently", () => {
      // Independently, because an organization that sets only an idle timeout
      // must not thereby remove another organization's ceiling.
      expect(
        strictestSessionBound([
          { idleTimeoutMinutes: 30, maxLifetimeMinutes: 0 },
          { idleTimeoutMinutes: 60, maxLifetimeMinutes: 480 },
        ]),
      ).toEqual({ idleTimeoutMinutes: 30, maxLifetimeMinutes: 480 });
    });
  });
});

describe("given a window that has to be measured", () => {
  describe("when deciding how often to record activity", () => {
    it("writes at most once a quarter-window", () => {
      // Once a request would tax every signed-in request in the product for a
      // setting almost nobody has turned on; once a day - which is all
      // better-auth's own roll does - cannot tell an idle hour from an idle
      // minute.
      expect(lastSeenWriteIntervalMs(ONE_HOUR_IDLE)).toBe(15 * 60_000);
    });

    it("never writes more often than once a minute", () => {
      // A two-minute window must not turn into a write per request.
      expect(
        lastSeenWriteIntervalMs({
          idleTimeoutMinutes: 2,
          maxLifetimeMinutes: 0,
        }),
      ).toBe(60_000);
    });
  });
});

import {
  boundsNothing,
  lastSeenWriteIntervalMs,
  NO_SESSION_BOUND,
  sessionBoundVerdict,
  strictestSessionBound,
  type SessionBound,
} from "@langwatch/auth-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

const SIGNED_IN_AT = Temporal.Instant.from("2026-03-01T09:00:00.000Z");
const minutesAfter = (minutes: number) => SIGNED_IN_AT.add({ minutes });

const bound = (idleTimeoutMinutes: number, maxLifetimeMinutes = 0): SessionBound => ({
  idleTimeoutMinutes,
  maxLifetimeMinutes,
});

describe("the session window decision", () => {
  /** @scenario "No window means the session behaves as it always has" */
  it("keeps a week-old idle session alive when no window is set", () => {
    expect(boundsNothing(NO_SESSION_BOUND)).toBe(true);
    expect(
      sessionBoundVerdict({
        bound: NO_SESSION_BOUND,
        createdAt: SIGNED_IN_AT,
        lastSeenAt: SIGNED_IN_AT,
        now: minutesAfter(60 * 24 * 7),
      }),
    ).toEqual({ withinBound: true });
  });

  /** @scenario "An hour of nothing ends the session" */
  it("ends a session idle past its window, and says idle", () => {
    expect(
      sessionBoundVerdict({
        bound: bound(60),
        createdAt: SIGNED_IN_AT,
        lastSeenAt: SIGNED_IN_AT,
        now: minutesAfter(70),
      }),
    ).toEqual({ withinBound: false, reason: "idle" });
  });

  /** @scenario "Using it keeps it alive" */
  it("keeps a session used every half hour under an hourly window", () => {
    expect(
      sessionBoundVerdict({
        bound: bound(60),
        createdAt: SIGNED_IN_AT,
        lastSeenAt: minutesAfter(240),
        now: minutesAfter(270),
      }),
    ).toEqual({ withinBound: true });
  });

  /** @scenario "A maximum length is not extended by activity" */
  it("ends a session past its ceiling however active the person has been", () => {
    expect(
      sessionBoundVerdict({
        bound: bound(60, 8 * 60),
        createdAt: SIGNED_IN_AT,
        lastSeenAt: minutesAfter(9 * 60),
        now: minutesAfter(9 * 60),
      }),
    ).toEqual({ withinBound: false, reason: "max_lifetime" });
  });

  /** @scenario "A member of two organizations is bound by the tighter one" */
  it("takes the tighter window, and a zero never loosens a real one", () => {
    expect(strictestSessionBound([bound(60), NO_SESSION_BOUND])).toEqual({
      idleTimeoutMinutes: 60,
      maxLifetimeMinutes: 0,
    });
    expect(strictestSessionBound([bound(60, 0), bound(0, 480)])).toEqual({
      idleTimeoutMinutes: 60,
      maxLifetimeMinutes: 480,
    });
  });

  /** @scenario "Reading a session costs no more than it did" */
  it("writes the activity stamp at most once a quarter-window, and never without one", () => {
    expect(lastSeenWriteIntervalMs(bound(60))).toBe(15 * 60_000);
    expect(lastSeenWriteIntervalMs(bound(2))).toBe(60_000);
    expect(lastSeenWriteIntervalMs(NO_SESSION_BOUND)).toBe(0);
  });
});

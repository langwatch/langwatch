import { NO_LOCKOUT, NO_SESSION_BOUND, type SessionBound } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const SIGNED_IN_AT = Temporal.Instant.from("2026-03-01T09:00:00.000Z");
let clock = SIGNED_IN_AT;
const now = () => clock;
const minutesPass = (minutes: number) => {
  clock = clock.add({ minutes });
};

const bound = (idleTimeoutMinutes: number, maxLifetimeMinutes = 0): SessionBound => ({
  idleTimeoutMinutes,
  maxLifetimeMinutes,
});

const session = (lastSeenAt: Instant | null) => ({
  id: "session-1",
  userId: "sam",
  createdAt: SIGNED_IN_AT,
  lastSeenAt,
  updatedAt: SIGNED_IN_AT,
});

beforeEach(() => {
  clock = SIGNED_IN_AT;
});

describe("bounding how long a signed-in browser session lasts", () => {
  /** @scenario "No window means the session behaves as it always has" */
  it("costs an unbounded installation nothing and keeps a week-old session", async () => {
    const fixture = signInSecurityFixture({ now });
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    minutesPass(60 * 24 * 7);

    expect(await fixture.sessionBound.enforce({ session: session(null) })).toEqual({
      withinBound: true,
    });
    expect(fixture.touched).toEqual([]);
  });

  /** @scenario "An hour of nothing ends the session" */
  it("refuses a session idle past its window", async () => {
    const fixture = signInSecurityFixture({ now });
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: bound(60),
      members: ["sam"],
    });
    minutesPass(70);

    expect(await fixture.sessionBound.enforce({ session: session(SIGNED_IN_AT) })).toEqual({
      withinBound: false,
      reason: "idle",
    });
  });

  /** @scenario "Using it keeps it alive" */
  it("keeps a session used within the window, and rolls the stamp once a quarter-window", async () => {
    const fixture = signInSecurityFixture({ now });
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: bound(60),
      members: ["sam"],
    });
    minutesPass(20);

    expect(await fixture.sessionBound.enforce({ session: session(SIGNED_IN_AT) })).toEqual({
      withinBound: true,
    });
    expect(fixture.touched).toEqual([{ sessionId: "session-1", at: clock }]);
  });

  /** @scenario "A maximum length is not extended by activity" */
  it("ends a session past its ceiling however recently it was used", async () => {
    const fixture = signInSecurityFixture({ now });
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: bound(60, 8 * 60),
      members: ["sam"],
    });
    minutesPass(9 * 60);

    expect(await fixture.sessionBound.enforce({ session: session(clock) })).toEqual({
      withinBound: false,
      reason: "max_lifetime",
    });
  });

  /** @scenario "A member of two organizations is bound by the tighter one" */
  it("bounds the whole session by the tighter organization's window", async () => {
    const fixture = signInSecurityFixture({ now });
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: bound(60),
      members: ["sam"],
    });
    await fixture.organization({
      id: "globex",
      lockout: NO_LOCKOUT,
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    minutesPass(70);

    expect(await fixture.sessionBound.enforce({ session: session(SIGNED_IN_AT) })).toEqual({
      withinBound: false,
      reason: "idle",
    });
  });

  /** @scenario "Saving a window ends the sessions already past it" */
  it("judges a session minted before the window by its own last write", async () => {
    const fixture = signInSecurityFixture({ now });
    minutesPass(60 * 24 * 30);
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: bound(60),
      members: ["sam"],
    });

    // `lastSeenAt` null: the stamp never existed under a window, so the row's
    // own `updatedAt` stands in and a month-idle session is ended at once.
    expect(await fixture.sessionBound.enforce({ session: session(null) })).toEqual({
      withinBound: false,
      reason: "idle",
    });
  });

  /** @scenario "A member of two organizations is bound by the tighter one" */
  it("leaves somebody who belongs to no bounded organization alone", async () => {
    const fixture = signInSecurityFixture({ now });
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: bound(60),
      members: ["ana"],
    });
    minutesPass(70);

    expect(await fixture.sessionBound.enforce({ session: session(SIGNED_IN_AT) })).toEqual({
      withinBound: true,
    });
  });
});

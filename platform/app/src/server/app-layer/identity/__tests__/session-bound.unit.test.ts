import { NO_SESSION_BOUND, type SessionBound } from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import {
  type BoundableSession,
  SessionBoundService,
} from "../session-bound.service";

/**
 * Bounding a browser session, as the service actually runs it (GAC-10,
 * specs/identity/org-session-lifetime.feature).
 *
 * The arithmetic is proved next door in `@langwatch/identity`. What is proved
 * HERE is what the pure module cannot reach: that a session past its window
 * is ENDED rather than merely refused, that a deployment where nobody has set
 * a window does no work at all, and that recording activity is rare rather
 * than per request.
 */

const ONE_HOUR_IDLE: SessionBound = {
  idleTimeoutMinutes: 60,
  maxLifetimeMinutes: 0,
};

const SIGNED_IN_AT = new Date("2026-09-16T09:00:00.000Z");
const minutesAfterSignIn = (minutes: number) =>
  new Date(SIGNED_IN_AT.getTime() + minutes * 60_000);

function stackWhere({
  installationWide = NO_SESSION_BOUND,
  forUser = NO_SESSION_BOUND,
  nowMinutes,
}: {
  installationWide?: SessionBound;
  forUser?: SessionBound;
  nowMinutes: number;
}) {
  const ended: { token: string; userId: string }[] = [];
  const touched: { sessionId: string; at: Date }[] = [];
  const policyReads: string[] = [];

  const service = new SessionBoundService({
    policy: {
      forUser: async ({ userId }) => {
        policyReads.push(userId);
        return forUser;
      },
      installationWide: async () => installationWide,
    },
    activity: {
      touch: async (args) => {
        touched.push(args);
      },
    },
    ending: {
      end: async (args) => {
        ended.push(args);
      },
    },
    now: () => minutesAfterSignIn(nowMinutes),
  });

  return { service, ended, touched, policyReads };
}

const sessionLastUsed = (minutes: number): BoundableSession => ({
  id: "session-1",
  token: "token-1",
  userId: "user-sam",
  createdAt: SIGNED_IN_AT,
  lastSeenAt: minutesAfterSignIn(minutes),
  updatedAt: minutesAfterSignIn(minutes),
});

describe("given a deployment where no organization bounds a session", () => {
  describe("when a signed-in request is served", () => {
    /** @scenario "Reading a session costs no more than it did" */
    it("asks nothing further and ends nothing", async () => {
      const stack = stackWhere({
        installationWide: NO_SESSION_BOUND,
        nowMinutes: 60 * 24 * 30,
      });

      const verdict = await stack.service.enforce({
        session: sessionLastUsed(0),
      });

      expect(verdict).toEqual({ withinBound: true });
      // The early-out. Not even the per-person policy is read, so a
      // deployment that has not turned this on pays one memoised answer for
      // the whole feature.
      expect(stack.policyReads).toEqual([]);
      expect(stack.touched).toEqual([]);
      expect(stack.ended).toEqual([]);
    });
  });
});

describe("given an organization that ends idle sessions after an hour", () => {
  describe("when the session is past the window", () => {
    /** @scenario "An hour of nothing ends the session" */
    it("ends it rather than merely refusing this one request", async () => {
      const stack = stackWhere({
        installationWide: ONE_HOUR_IDLE,
        forUser: ONE_HOUR_IDLE,
        nowMinutes: 70,
      });

      const verdict = await stack.service.enforce({
        session: sessionLastUsed(0),
      });

      expect(verdict).toEqual({ withinBound: false, reason: "idle" });
      // The assertion this file exists for. A session refused here and still
      // honoured by the cached copy has not ended, and would keep answering
      // for up to thirty days.
      expect(stack.ended).toEqual([{ token: "token-1", userId: "user-sam" }]);
    });
  });

  describe("when the session is still in use", () => {
    /** @scenario "Using it keeps it alive" */
    it("leaves it alone", async () => {
      const stack = stackWhere({
        installationWide: ONE_HOUR_IDLE,
        forUser: ONE_HOUR_IDLE,
        nowMinutes: 70,
      });

      const verdict = await stack.service.enforce({
        session: sessionLastUsed(40),
      });

      expect(verdict).toEqual({ withinBound: true });
      expect(stack.ended).toEqual([]);
    });

    it("records activity once a quarter-window, not every request", async () => {
      const notDueYet = stackWhere({
        installationWide: ONE_HOUR_IDLE,
        forUser: ONE_HOUR_IDLE,
        nowMinutes: 10,
      });
      await notDueYet.service.enforce({ session: sessionLastUsed(0) });
      expect(notDueYet.touched).toEqual([]);

      const due = stackWhere({
        installationWide: ONE_HOUR_IDLE,
        forUser: ONE_HOUR_IDLE,
        nowMinutes: 20,
      });
      await due.service.enforce({ session: sessionLastUsed(0) });
      expect(due.touched).toHaveLength(1);
    });
  });

  describe("when the session has never carried our own stamp", () => {
    it("falls back to when the session was last written", async () => {
      // Every session that predates the column. Reading the fallback as "not
      // idle" instead would leave a month of existing thirty-day sessions
      // unbounded by a window an administrator has just set.
      const stack = stackWhere({
        installationWide: ONE_HOUR_IDLE,
        forUser: ONE_HOUR_IDLE,
        nowMinutes: 60 * 24 * 3,
      });

      const verdict = await stack.service.enforce({
        session: {
          ...sessionLastUsed(0),
          lastSeenAt: null,
          updatedAt: SIGNED_IN_AT,
        },
      });

      expect(verdict).toEqual({ withinBound: false, reason: "idle" });
    });
  });
});

describe("given a person whose organizations set no window", () => {
  describe("when somebody else's organization does", () => {
    /** @scenario "One organization's threshold does not lock another organization's members" */
    it("leaves their session alone", async () => {
      // `installationWide` bounds because another customer set it; this
      // person belongs to nobody who did.
      const stack = stackWhere({
        installationWide: ONE_HOUR_IDLE,
        forUser: NO_SESSION_BOUND,
        nowMinutes: 60 * 24 * 7,
      });

      const verdict = await stack.service.enforce({
        session: sessionLastUsed(0),
      });

      expect(verdict).toEqual({ withinBound: true });
      expect(stack.ended).toEqual([]);
    });
  });
});

describe("given an organization that caps a session's whole length", () => {
  describe("when somebody has been working straight through it", () => {
    /** @scenario "A maximum length is not extended by activity" */
    it("ends it, and does not blame idling", async () => {
      const stack = stackWhere({
        installationWide: { idleTimeoutMinutes: 60, maxLifetimeMinutes: 480 },
        forUser: { idleTimeoutMinutes: 60, maxLifetimeMinutes: 480 },
        nowMinutes: 9 * 60,
      });

      const verdict = await stack.service.enforce({
        session: sessionLastUsed(9 * 60 - 1),
      });

      expect(verdict).toEqual({
        withinBound: false,
        reason: "max_lifetime",
      });
      expect(stack.ended).toHaveLength(1);
    });
  });
});

describe("given ending a session fails", () => {
  describe("when it is past its window", () => {
    it("still refuses it", async () => {
      // A destroy that throws must never become a session that survived its
      // own window. The row is retried on the next request, and there will be
      // one, because the browser still holds the cookie.
      const service = new SessionBoundService({
        policy: {
          forUser: async () => ONE_HOUR_IDLE,
          installationWide: async () => ONE_HOUR_IDLE,
        },
        activity: { touch: async () => {} },
        ending: {
          end: async () => {
            throw new Error("the store is unreachable");
          },
        },
        now: () => minutesAfterSignIn(70),
      });

      await expect(
        service.enforce({ session: sessionLastUsed(0) }),
      ).resolves.toEqual({ withinBound: false, reason: "idle" });
    });
  });
});

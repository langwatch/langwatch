/**
 * The settings surface's own logic: the cross-field guard on the session
 * window, when an activation asks the plan, sweeping sessions on save, and
 * releasing a held account.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */
import { describe, expect, it, vi } from "vitest";

import {
  assertSessionWindowSensible,
  releaseHeldAccount,
  sweepSessionsPastWindow,
  willActivateSignInSecurity,
} from "../sign-in-security-settings";

describe("assertSessionWindowSensible", () => {
  describe("given no maximum session length", () => {
    it("never refuses, whatever the idle timeout is", () => {
      expect(() =>
        assertSessionWindowSensible({
          sessionIdleTimeoutMinutes: 500,
          sessionMaxLifetimeMinutes: 0,
        }),
      ).not.toThrow();
    });
  });

  describe("given a maximum session length shorter than the idle timeout", () => {
    it("refuses with the stable code", () => {
      try {
        assertSessionWindowSensible({
          sessionIdleTimeoutMinutes: 120,
          sessionMaxLifetimeMinutes: 60,
        });
        expect.unreachable("expected a refusal");
      } catch (error) {
        expect((error as { code?: string }).code).toBe(
          "identity_session_max_lifetime_too_short",
        );
      }
    });
  });

  describe("given a maximum session length equal to or longer than the idle timeout", () => {
    it("does not refuse", () => {
      expect(() =>
        assertSessionWindowSensible({
          sessionIdleTimeoutMinutes: 60,
          sessionMaxLifetimeMinutes: 60,
        }),
      ).not.toThrow();
      expect(() =>
        assertSessionWindowSensible({
          sessionIdleTimeoutMinutes: 60,
          sessionMaxLifetimeMinutes: 90,
        }),
      ).not.toThrow();
    });
  });
});

const OFF = {
  lockoutAfterFailedAttempts: 0,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

describe("willActivateSignInSecurity", () => {
  describe("given both rules are fully off", () => {
    it("says a new lock-out threshold activates it", () => {
      expect(
        willActivateSignInSecurity({
          current: OFF,
          next: { ...OFF, lockoutAfterFailedAttempts: 5 },
        }),
      ).toBe(true);
    });

    it("says a new idle timeout activates it", () => {
      expect(
        willActivateSignInSecurity({
          current: OFF,
          next: { ...OFF, sessionIdleTimeoutMinutes: 60 },
        }),
      ).toBe(true);
    });

    it("says leaving both off does not activate it", () => {
      expect(
        willActivateSignInSecurity({
          current: OFF,
          next: { ...OFF },
        }),
      ).toBe(false);
    });
  });

  describe("given a rule is already active", () => {
    const active = { ...OFF, lockoutAfterFailedAttempts: 5 };

    it("says adjusting its numbers does not activate it again", () => {
      expect(
        willActivateSignInSecurity({
          current: active,
          next: { ...active, lockoutAfterFailedAttempts: 8 },
        }),
      ).toBe(false);
    });

    it("says turning everything off does not activate it", () => {
      expect(willActivateSignInSecurity({ current: active, next: OFF })).toBe(
        false,
      );
    });
  });
});

describe("sweepSessionsPastWindow", () => {
  describe("given three of this organization's sessions are past the new window", () => {
    /** @scenario "Saving a window ends the sessions already past it" */
    it("ends exactly the sessions the bound refuses, and leaves the rest", async () => {
      const records = [
        {
          id: "s1",
          token: "t1",
          userId: "sam",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt: new Date("2026-09-01T00:00:00Z"),
          updatedAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: "s2",
          token: "t2",
          userId: "ana",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt: new Date("2026-09-16T00:00:00Z"),
          updatedAt: new Date("2026-09-16T00:00:00Z"),
        },
        {
          id: "s3",
          token: "t3",
          userId: "gil",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt: new Date("2026-09-01T00:00:00Z"),
          updatedAt: new Date("2026-09-01T00:00:00Z"),
        },
      ];
      const forOrganization = vi.fn().mockResolvedValue(records);
      // sam and gil are idle past the window; ana is still working.
      const enforce = vi.fn(async ({ session }: { session: { id: string } }) =>
        session.id === "s2"
          ? { withinBound: true as const }
          : { withinBound: false as const, reason: "idle" as const },
      );

      const ended = await sweepSessionsPastWindow({
        organizationId: "acme",
        sessions: { forOrganization },
        sessionBound: { enforce },
      });

      expect(ended).toBe(2);
      expect(forOrganization).toHaveBeenCalledWith({ organizationId: "acme" });
      expect(enforce).toHaveBeenCalledTimes(3);
      expect(enforce).toHaveBeenCalledWith({
        session: expect.objectContaining({
          id: "s1",
          token: "t1",
          userId: "sam",
        }),
      });
    });
  });

  describe("given the organization has no sessions to judge", () => {
    it("asks the bound nothing and ends nothing", async () => {
      const enforce = vi.fn();

      const ended = await sweepSessionsPastWindow({
        organizationId: "acme",
        sessions: { forOrganization: vi.fn().mockResolvedValue([]) },
        sessionBound: { enforce },
      });

      expect(ended).toBe(0);
      expect(enforce).not.toHaveBeenCalled();
    });
  });
});

describe("releaseHeldAccount", () => {
  describe("given the target is held and is a member of the organization", () => {
    /** @scenario "An administrator can release a held account" */
    it("releases the account and records the release with the administrator's id", async () => {
      const released = vi.fn().mockResolvedValue(undefined);
      const release = vi.fn().mockResolvedValue(1);

      const result = await releaseHeldAccount({
        organizationId: "acme",
        userId: "sam",
        actorUserId: "ana",
        membership: { isMember: vi.fn().mockResolvedValue(true) },
        lockout: { release },
        evidence: { released },
      });

      expect(result).toEqual({ released: true });
      expect(release).toHaveBeenCalledWith({ userId: "sam" });
      expect(released).toHaveBeenCalledWith({
        organizationId: "acme",
        userId: "sam",
        actorUserId: "ana",
      });
    });
  });

  describe("given the target was not actually held", () => {
    it("reports no release and writes nothing to the record", async () => {
      const released = vi.fn();

      const result = await releaseHeldAccount({
        organizationId: "acme",
        userId: "sam",
        actorUserId: "ana",
        membership: { isMember: vi.fn().mockResolvedValue(true) },
        lockout: { release: vi.fn().mockResolvedValue(0) },
        evidence: { released },
      });

      expect(result).toEqual({ released: false });
      expect(released).not.toHaveBeenCalled();
    });
  });

  describe("given the target is not a member of this organization", () => {
    it("refuses before ever touching the lock-out", async () => {
      const release = vi.fn();

      await expect(
        releaseHeldAccount({
          organizationId: "globex",
          userId: "sam",
          actorUserId: "ana",
          membership: { isMember: vi.fn().mockResolvedValue(false) },
          lockout: { release },
          evidence: { released: vi.fn() },
        }),
      ).rejects.toMatchObject({ code: "user_not_in_organization" });
      expect(release).not.toHaveBeenCalled();
    });
  });
});

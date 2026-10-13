/**
 * When a save asks for the plan, and which session window it refuses.
 * @see specs/identity/org-session-lifetime.feature
 */
import { describe, expect, it } from "vitest";

import {
  assertSessionWindowSensible,
  willActivateSignInSecurity,
} from "../sign-in-security.rules.ts";

const OFF = {
  lockoutAfterFailedAttempts: 0,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

describe("assertSessionWindowSensible", () => {
  describe("given no maximum session length", () => {
    it("never refuses, whatever the idle timeout is", () => {
      expect(() =>
        assertSessionWindowSensible({
          sessionIdleTimeoutMinutes: 600,
          sessionMaxLifetimeMinutes: 0,
        }),
      ).not.toThrow();
    });
  });

  describe("given a maximum session length shorter than the idle timeout", () => {
    it("refuses with the stable code", () => {
      expect(() =>
        assertSessionWindowSensible({
          sessionIdleTimeoutMinutes: 60,
          sessionMaxLifetimeMinutes: 30,
        }),
      ).toThrow(expect.objectContaining({ code: "identity_session_max_lifetime_too_short" }));
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
          sessionMaxLifetimeMinutes: 480,
        }),
      ).not.toThrow();
    });
  });
});

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
      expect(willActivateSignInSecurity({ current: OFF, next: OFF })).toBe(false);
    });
  });

  describe("given a rule is already active", () => {
    const active = { ...OFF, lockoutAfterFailedAttempts: 5 };

    it("says adjusting its numbers does not activate it again", () => {
      expect(
        willActivateSignInSecurity({
          current: active,
          next: { ...active, lockoutAfterFailedAttempts: 3, sessionIdleTimeoutMinutes: 60 },
        }),
      ).toBe(false);
    });

    it("says turning everything off does not activate it", () => {
      expect(willActivateSignInSecurity({ current: active, next: OFF })).toBe(false);
    });
  });
});

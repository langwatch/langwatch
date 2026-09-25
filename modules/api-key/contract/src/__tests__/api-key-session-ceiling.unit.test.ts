/**
 * When a CLI login key's session runs out: the sooner of the refresh
 * window from now and the org's max session duration from session start.
 * Spec: modules/api-key/specs/api-key.feature
 */
import { describe, expect, it } from "vitest";

import { loginKeyExpiresAt } from "../api-key.session-ceiling.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("loginKeyExpiresAt", () => {
  describe("given no organization ceiling", () => {
    it("uses the refresh window alone", () => {
      const nowMs = 1_000_000;
      const refreshWindowMs = 60_000;

      const result = loginKeyExpiresAt({
        nowMs,
        sessionStartedAtMs: nowMs,
        maxSessionDurationDays: 0,
        refreshWindowMs,
      });

      expect(result.epochMilliseconds).toBe(nowMs + refreshWindowMs);
    });
  });

  describe("given a ceiling further away than the refresh window", () => {
    it("uses the refresh window", () => {
      const sessionStartedAtMs = 0;
      const nowMs = 1000;
      const refreshWindowMs = 60_000;

      const result = loginKeyExpiresAt({
        nowMs,
        sessionStartedAtMs,
        maxSessionDurationDays: 30,
        refreshWindowMs,
      });

      expect(result.epochMilliseconds).toBe(nowMs + refreshWindowMs);
    });
  });

  describe("given a ceiling sooner than the refresh window", () => {
    /** @scenario "A session's login-key expiry tracks the sooner of the refresh window and the org ceiling" */
    it("brings the expiry forward to the ceiling", () => {
      const sessionStartedAtMs = 0;
      const maxSessionDurationDays = 1;
      const nowMs = maxSessionDurationDays * DAY_MS - 1000;
      const refreshWindowMs = 60_000;

      const result = loginKeyExpiresAt({
        nowMs,
        sessionStartedAtMs,
        maxSessionDurationDays,
        refreshWindowMs,
      });

      expect(result.epochMilliseconds).toBe(sessionStartedAtMs + maxSessionDurationDays * DAY_MS);
    });
  });

  describe("given a refresh recomputing the window on a session already past its ceiling", () => {
    /** @scenario "A session's login-key expiry tracks the sooner of the refresh window and the org ceiling" */
    it("does not slide past the ceiling on a later refresh", () => {
      const sessionStartedAtMs = 0;
      const maxSessionDurationDays = 1;
      const nowMs = maxSessionDurationDays * DAY_MS + 1000;

      const result = loginKeyExpiresAt({
        nowMs,
        sessionStartedAtMs,
        maxSessionDurationDays,
        refreshWindowMs: 60_000,
      });

      expect(result.epochMilliseconds).toBe(sessionStartedAtMs + maxSessionDurationDays * DAY_MS);
    });
  });
});

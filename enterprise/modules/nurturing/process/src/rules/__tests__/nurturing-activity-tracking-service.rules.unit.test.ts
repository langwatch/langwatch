/**
 * What a returning session tells Customer.io, and how rarely.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appActiveCacheSize,
  cacheSize,
  fire,
  resetCache,
} from "../nurturing-activity-tracking-service.rules.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

beforeEach(() => resetCache());
afterEach(() => vi.useRealTimers());

describe("fire", () => {
  describe("given a person whose session has just been established", () => {
    describe("when the session callback fires", () => {
      /** @scenario "User login pushes last_active_at to Customer.io" */
      it("decides to identify them with the moment they were last active", () => {
        const calls = fire({ userId: "user-1" });

        const [call] = calls as [
          { type: "identify"; userId: string; traits: { last_active_at: string } },
        ];
        expect(call.type).toBe("identify");
        expect(call.userId).toBe("user-1");
        expect(Date.parse(call.traits.last_active_at)).not.toBeNaN();
      });

      it("decides to track app_active for them next to the identify", () => {
        const calls = fire({ userId: "user-1" });

        expect(calls).toHaveLength(2);
        expect(calls[1]).toEqual({ type: "track", userId: "user-1", event: "app_active" });
      });
    });
  });

  describe("given a person refreshing their session repeatedly within the hour", () => {
    describe("when the session callback fires each time", () => {
      /** @scenario "Activity tracking is debounced to avoid excessive API calls" */
      it("decides to identify them once, not once per refresh", () => {
        expect(fire({ userId: "user-1" }).map((call) => call.type)).toEqual(["identify", "track"]);
        expect(fire({ userId: "user-1" })).toHaveLength(0);
        expect(fire({ userId: "user-1" })).toHaveLength(0);
        expect(cacheSize()).toBe(1);
      });

      /** @scenario Activity tracking fires an app_active event with the same debounce */
      it("decides to track app_active once, not once per refresh", () => {
        const tracked = [fire({ userId: "user-1" }), fire({ userId: "user-1" })]
          .flat()
          .filter((call) => call.type === "track");

        expect(tracked).toEqual([{ type: "track", userId: "user-1", event: "app_active" }]);
        expect(appActiveCacheSize()).toBe(1);
      });
    });

    describe("when an hour has passed since the last session", () => {
      it("decides the identify and app_active again", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
        fire({ userId: "user-1" });

        vi.advanceTimersByTime(ONE_HOUR_MS + 1);

        expect(fire({ userId: "user-1" }).map((call) => call.type)).toEqual(["identify", "track"]);
      });
    });
  });

  describe("given people whose last session is more than an hour old", () => {
    describe("when another person's session fires", () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
        fire({ userId: "user-1" });
        fire({ userId: "user-2" });
      });

      it("evicts the identify entries older than one hour", () => {
        expect(cacheSize()).toBe(2);

        vi.advanceTimersByTime(ONE_HOUR_MS + 1);
        fire({ userId: "user-3" });

        expect(cacheSize()).toBe(1);
      });

      it("evicts the app_active entries older than one hour as well", () => {
        expect(appActiveCacheSize()).toBe(2);

        vi.advanceTimersByTime(ONE_HOUR_MS + 1);
        fire({ userId: "user-3" });

        expect(appActiveCacheSize()).toBe(1);
      });
    });
  });

  describe("given a person without an organization", () => {
    describe("when the session callback fires", () => {
      it("decides nothing, to avoid creating a ghost profile", () => {
        expect(fire({ userId: "user-1", hasOrganization: false })).toEqual([]);
        expect(cacheSize()).toBe(0);
        expect(appActiveCacheSize()).toBe(0);
      });
    });
  });
});

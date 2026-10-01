/**
 * What a returning session tells Customer.io, and how rarely.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { cacheSize, fire, resetCache } from "../nurturing-activity-tracking-service.rules.ts";

beforeEach(() => resetCache());

describe("fire", () => {
  describe("given a person whose session has just been established", () => {
    describe("when the session callback fires", () => {
      /** @scenario "User login pushes last_active_at to Customer.io" */
      it("decides to identify them with the moment they were last active", () => {
        const calls = fire({ userId: "user-1" });

        expect(calls).toHaveLength(1);
        const [call] = calls as [
          { type: "identify"; userId: string; traits: { last_active_at: string } },
        ];
        expect(call.type).toBe("identify");
        expect(call.userId).toBe("user-1");
        expect(Date.parse(call.traits.last_active_at)).not.toBeNaN();
      });
    });
  });

  describe("given a person refreshing their session repeatedly within the hour", () => {
    describe("when the session callback fires each time", () => {
      /** @scenario "Activity tracking is debounced to avoid excessive API calls" */
      it("decides to identify them once, not once per refresh", () => {
        expect(fire({ userId: "user-1" })).toHaveLength(1);
        expect(fire({ userId: "user-1" })).toHaveLength(0);
        expect(fire({ userId: "user-1" })).toHaveLength(0);
        expect(cacheSize()).toBe(1);
      });
    });
  });

  describe("given a person without an organization", () => {
    describe("when the session callback fires", () => {
      it("decides nothing, to avoid creating a ghost profile", () => {
        expect(fire({ userId: "user-1", hasOrganization: false })).toEqual([]);
      });
    });
  });
});

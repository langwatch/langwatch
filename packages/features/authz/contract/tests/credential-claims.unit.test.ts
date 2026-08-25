import { describe, expect, it } from "vitest";
import { arbitrateClaims } from "../src/credential-claims";

type TestClaim = { kind: "api-key"; token: string } | { kind: "session"; userId: string };

describe("credential arbitration", () => {
  describe("given exactly one credential kind claims the request", () => {
    /** @scenario "A single claim wins the arbitration" */
    it("chooses that claim and names its kind", () => {
      const claim: TestClaim = { kind: "api-key", token: "sk-lw-1" };

      const arbitration = arbitrateClaims<TestClaim>([claim, null, undefined]);

      expect(arbitration).toEqual({ outcome: "claimed", claim });
    });
  });

  describe("given no credential kind claims the request", () => {
    /** @scenario "No claims is structurally unauthenticated" */
    it("answers unclaimed with no chosen kind", () => {
      expect(arbitrateClaims<TestClaim>([null, undefined])).toEqual({
        outcome: "unclaimed",
      });
      expect(arbitrateClaims<TestClaim>([])).toEqual({ outcome: "unclaimed" });
    });
  });

  describe("given two credential kinds both claim the request", () => {
    /** @scenario "Competing claims are contested, never ranked" */
    it("refuses as contested naming every claimant, in any order given", () => {
      const apiKey: TestClaim = { kind: "api-key", token: "sk-lw-1" };
      const session: TestClaim = { kind: "session", userId: "u1" };

      expect(arbitrateClaims<TestClaim>([apiKey, session])).toEqual({
        outcome: "contested",
        kinds: ["api-key", "session"],
      });
      expect(arbitrateClaims<TestClaim>([session, apiKey])).toEqual({
        outcome: "contested",
        kinds: ["session", "api-key"],
      });
    });
  });
});

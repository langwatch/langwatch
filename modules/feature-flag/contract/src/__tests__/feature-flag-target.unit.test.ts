import { describe, expect, it } from "vitest";

import { ruleContextForTarget, type FeatureFlagTarget } from "../feature-flag-target.ts";

describe("given a flag read made on behalf of a signed-in user", () => {
  describe("when the feature flag service resolves it", () => {
    /** @scenario "the session's email reaches the store on a flag read" */
    it("hands the store that user's email next to its other rule context", () => {
      const target: FeatureFlagTarget = {
        kind: "user",
        userId: "user_1",
        userEmail: "qa@acme.com",
      };

      expect(ruleContextForTarget(target)).toEqual(
        expect.objectContaining({ userEmail: "qa@acme.com" }),
      );
    });
  });

  describe("given the caller has no session email", () => {
    it("hands the store no email, so no domain rule can match", () => {
      const target: FeatureFlagTarget = { kind: "user", userId: "user_2" };

      expect(ruleContextForTarget(target).userEmail).toBeUndefined();
    });
  });

  describe("given the caller is a system target", () => {
    it("never carries an email, even if one were attached", () => {
      const target: FeatureFlagTarget = { kind: "system" };

      expect(ruleContextForTarget(target).userEmail).toBeUndefined();
    });
  });
});

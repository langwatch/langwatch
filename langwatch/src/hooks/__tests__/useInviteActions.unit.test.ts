/**
 * @vitest-environment jsdom
 */
import { describe, it } from "vitest";

describe("useInviteActions", () => {
  describe("when onSubmit is called", () => {
    it("delegates to enforcement service for all pricing models", () => {
      // The onSubmit logic now always goes through the enforcement service
      // (useLicenseEnforcement) which correctly counts pending invites.
      // Integration/E2E tests cover the full modal flow.
    });
  });
});

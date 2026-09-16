import { describe, expect, it } from "vitest";
import { resolveOrglessDestination } from "../resolveOrglessDestination";

/**
 * The fork that used to have one branch.
 *
 * Belonging to no organization was read as "new customer" and answered with
 * the bootstrap screen, which is right for a signup and wrong for the
 * administrator whose mandatory test sign-in put them there.
 */
describe("resolveOrglessDestination", () => {
  describe("given the person arrived through a connection that is not live", () => {
    /** @scenario "A test arrival is not sent to the screen that creates an organization" */
    it("sends them to what happened to their test sign-in", () => {
      expect(
        resolveOrglessDestination({ isPending: false, isTestArrival: true }),
      ).toBe("/auth/sso-test-complete");
    });
  });

  describe("given the person simply has no organization yet", () => {
    /** @scenario "A test arrival is not sent to the screen that creates an organization" */
    it("still reaches the screen that creates one", () => {
      expect(
        resolveOrglessDestination({ isPending: false, isTestArrival: false }),
      ).toBe("/onboarding/welcome");
    });
  });

  describe("given it is not known yet which of the two they are", () => {
    /** @scenario "Nobody is sent anywhere while the question is still out" */
    it("sends them nowhere until it is", () => {
      expect(
        resolveOrglessDestination({ isPending: true, isTestArrival: false }),
      ).toBeNull();
    });
  });
});

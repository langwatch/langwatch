import { describe, expect, it } from "vitest";
import { isSsoConnectionInSetup, SSO_CONNECTION_STATES } from "../index";

/**
 * Which states mean "still being set up".
 *
 * Pinned state by state rather than through a caller, because the cost of
 * getting it wrong is asymmetric: a state wrongly counted as setup tells
 * somebody to finish something that does not exist and refuses them an
 * organization, with no way out of either.
 */
const IN_SETUP = [
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "VERIFICATION_PENDING",
  "VERIFIED",
];

describe("isSsoConnectionInSetup", () => {
  describe.each(IN_SETUP)("given a connection that is %s", (state) => {
    it("is still being set up", () => {
      expect(isSsoConnectionInSetup(state)).toBe(true);
    });
  });

  describe.each(
    SSO_CONNECTION_STATES.filter((state) => !IN_SETUP.includes(state)),
  )("given a connection that is %s", (state) => {
    it("is not being set up", () => {
      expect(isSsoConnectionInSetup(state)).toBe(false);
    });
  });

  describe("given a state nobody has defined yet", () => {
    it("is not being set up, so a new state strands nobody", () => {
      expect(isSsoConnectionInSetup("SOMETHING_NEW")).toBe(false);
    });
  });
});

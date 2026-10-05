/**
 * The Explorer's Instant Evals gate: the release flag or the organization's
 * own switch, either one released or still loading.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { describe, expect, it } from "vitest";

import { isInstantEvalAvailable } from "../instant-eval-access.ts";

const SETTLED_OFF = {
  flagReleased: false,
  flagLoading: false,
  accessReleased: false,
  accessLoading: false,
};

describe("given the release flag is off", () => {
  describe("when the organization switched Instant Evals on itself", () => {
    /** @scenario "An organization that switched itself on is judged without the flag" */
    it("lets the submit reach the estimate", () => {
      expect(isInstantEvalAvailable({ ...SETTLED_OFF, accessReleased: true })).toBe(true);
    });
  });

  describe("when neither read says released and both have settled", () => {
    it("refuses before any estimate", () => {
      expect(isInstantEvalAvailable(SETTLED_OFF)).toBe(false);
    });
  });

  describe("when either read is still in flight", () => {
    it.each([{ flagLoading: true }, { accessLoading: true }])(
      "counts as available, so a slow read never hides the feature (%o)",
      (loading) => {
        expect(isInstantEvalAvailable({ ...SETTLED_OFF, ...loading })).toBe(true);
      },
    );
  });
});

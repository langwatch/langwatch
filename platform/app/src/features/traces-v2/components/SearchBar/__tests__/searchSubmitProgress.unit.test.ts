import { describe, expect, it } from "vitest";

import { searchSubmitProgress } from "../searchSubmitProgress";

describe("searchSubmitProgress", () => {
  describe("given a sentence routed to an Instant Eval", () => {
    /** @scenario "The bar names the step between Enter and the progress bar" */
    it("names the router, then the estimate, then the start", () => {
      expect(
        searchSubmitProgress({
          isRouting: true,
          isEstimating: false,
          isStarting: false,
        }),
      ).toBe("Searching");
      expect(
        searchSubmitProgress({
          isRouting: false,
          isEstimating: true,
          isStarting: false,
        }),
      ).toBe("Estimating the Instant Eval");
      expect(
        searchSubmitProgress({
          isRouting: false,
          isEstimating: false,
          isStarting: true,
        }),
      ).toBe("Starting the Instant Eval");
    });
  });

  describe("when nothing is pending", () => {
    it("says nothing", () => {
      expect(
        searchSubmitProgress({
          isRouting: false,
          isEstimating: false,
          isStarting: false,
        }),
      ).toBeNull();
    });
  });
});

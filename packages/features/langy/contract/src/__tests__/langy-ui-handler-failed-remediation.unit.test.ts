/**
 * The advice a wrapped page failure gives the agent.
 *
 * `langy_ui_handler_failed` carries whatever code the page reported, and its
 * own tip is "read meta.errorCode for the page's own failure reason". Following
 * that advice used to end at a name. When the inner code has advice of its own,
 * the wrapper gives that instead, so the agent reads a next step.
 *
 * @see specs/langy/langy-ui-actions.feature
 */
import { describe, expect, it } from "vitest";

import { LangyUiHandlerFailedError } from "../langy.errors";

describe("given a page reported a failure of its own", () => {
  describe("when its code has remediation of its own", () => {
    /** @scenario "A refused action tells the agent how to write anyway" */
    it("gives the agent the inner code's advice", () => {
      const error = new LangyUiHandlerFailedError(
        "workbench.duplicateTarget",
        "langy_ui_page_out_of_date",
      );

      expect(error.meta?.errorCode).toBe("langy_ui_page_out_of_date");
      expect(error.tips?.join(" ")).toContain("--experiment");
    });
  });

  describe("when its code has no remediation of its own", () => {
    it("does not adopt tips from an unrelated code", () => {
      const error = new LangyUiHandlerFailedError(
        "workbench.duplicateTarget",
        "target_not_found",
      );

      expect(error.meta?.errorCode).toBe("target_not_found");
    });
  });

  describe("when the page named no code", () => {
    it("stays a platform fault", () => {
      const error = new LangyUiHandlerFailedError("workbench.run");

      expect(error.fault).toBe("platform");
      expect(error.meta?.errorCode).toBeUndefined();
    });
  });
});

/**
 * The chrome the small button of the Agent Testing surface applies, and the
 * variants it leaves alone.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { describe, expect, it } from "vitest";
import { smallButtonChrome } from "../small-button";

describe("smallButtonChrome", () => {
  describe("when the caller takes the outlined default", () => {
    it("draws the quiet border, the panel background and the hover", () => {
      expect(smallButtonChrome("outline")).toEqual({
        borderColor: "border",
        background: "bg.panel",
        _hover: { borderColor: "border.emphasized", background: "bg.muted" },
      });
    });
  });

  describe("when the caller asks for another variant", () => {
    /** @scenario "A solid button of the surface keeps the hover of its own variant" */
    it("leaves the outlined chrome off so the variant keeps its own hover", () => {
      expect(smallButtonChrome("solid")).toEqual({});
    });

    it("leaves the outlined chrome off for a ghost button too", () => {
      expect(smallButtonChrome("ghost")).toEqual({});
    });
  });
});

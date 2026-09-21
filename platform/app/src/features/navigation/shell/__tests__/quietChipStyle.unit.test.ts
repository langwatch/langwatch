/**
 * The enterprise pill and the Quick Search key cap share one chip
 * style, so neither can drift back to a colour of its own.
 *
 * Specs: specs/navigation/product-sidebars.feature,
 *        specs/navigation/settings-shell-v2.feature
 */

import { describe, expect, it } from "vitest";
import { QUIET_SIDEBAR_CHIP } from "../quietChipStyle";

describe("the quiet sidebar chip", () => {
  describe("when a sidebar marks an item with it", () => {
    it("uses grey type inside a hairline border", () => {
      expect(QUIET_SIDEBAR_CHIP.color).toBe("gray.400");
      expect(QUIET_SIDEBAR_CHIP.borderWidth).toBe("1px");
      expect(QUIET_SIDEBAR_CHIP.borderColor).toBe("border");
    });
  });
});

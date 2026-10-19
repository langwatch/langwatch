import { describe, expect, it } from "vitest";

import { toastActionStyle } from "../src/components/overlays/toaster.tsx";

describe("given a toast carrying an action", () => {
  describe("when it is shown on any status or in either mode", () => {
    /** @scenario "A toast's secondary action uses the toast's own foreground" */
    it("reads the action in the toast's foreground at reduced opacity", () => {
      expect(toastActionStyle.color).toBe("inherit");
      expect(toastActionStyle.opacity).toBeLessThan(1);
    });
  });
});

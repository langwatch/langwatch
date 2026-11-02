import { describe, expect, it } from "vitest";

import { lockedToggles, togglesOnKindChange } from "../coding-assistant-toggles.ts";

describe("coding-assistant toggles", () => {
  describe("when an admin picks pi as a tile's kind", () => {
    /** @scenario "An admin picking pi in the tile drawer gets the virtual key and bundled plan switched off" */
    it("switches the virtual key and the bundled plan off", () => {
      expect(togglesOnKindChange("pi")).toEqual({ allowVk: false, bundledPlan: false });
    });

    it("keeps the virtual key locked off for an opened or saved pi tile", () => {
      expect(lockedToggles("pi")).toEqual({ allowVk: false });
    });
  });

  describe("when an admin picks Cursor", () => {
    it("locks direct OTLP off and leaves the bundled plan alone", () => {
      expect(togglesOnKindChange("cursor")).toEqual({ allowOtelDirect: false });
    });
  });

  describe("when an admin picks a kind with no fixed toggles", () => {
    it("locks nothing", () => {
      expect(togglesOnKindChange("codex")).toEqual({});
    });
  });
});

import { describe, expect, it } from "vitest";

import { langyLauncherRightOffset } from "../langy-launcher-position.ts";

describe("langyLauncherRightOffset()", () => {
  describe("given no drawer is open", () => {
    /** @scenario "The launcher sits beside an open drawer, never on the sidebar" */
    it("sits in the bottom-right corner", () => {
      expect(
        langyLauncherRightOffset({ drawerEdge: null, sidebarRight: 212, viewportWidth: 1600 }),
      ).toBe(20);
    });
  });

  describe("given a drawer with room for the launcher between it and the sidebar", () => {
    /** @scenario "The launcher sits beside an open drawer, never on the sidebar" */
    it("sits just left of the drawer", () => {
      expect(
        langyLauncherRightOffset({ drawerEdge: 680, sidebarRight: 212, viewportWidth: 1600 }),
      ).toBe(700);
    });
  });

  describe("given a drawer so wide the launcher would land on the sidebar", () => {
    /** @scenario "The launcher sits beside an open drawer, never on the sidebar" */
    it("stays in the corner", () => {
      expect(
        langyLauncherRightOffset({ drawerEdge: 800, sidebarRight: 212, viewportWidth: 1024 }),
      ).toBe(20);
    });
  });

  describe("given a drawer that fills the screen", () => {
    /** @scenario "The launcher sits beside an open drawer, never on the sidebar" */
    it("stays in the corner", () => {
      expect(
        langyLauncherRightOffset({ drawerEdge: 1024, sidebarRight: 0, viewportWidth: 1024 }),
      ).toBe(20);
    });
  });
});

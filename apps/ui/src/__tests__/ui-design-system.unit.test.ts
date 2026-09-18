import { createDesignSystem } from "@langwatch/design-system/system";
import { describe, expect, it } from "vitest";

import { uiDesignSystem } from "../design-system";

/**
 * A module shipping semantic tokens must be named in the composition or they
 * resolve to nothing at runtime. Every unit test built its own system from the
 * module's config, so nothing saw the front door lose its primary action.
 */
describe("the application-composed design system", () => {
  describe("given a module that ships its own semantic tokens", () => {
    it("registers the front door's ground and action", () => {
      expect(uiDesignSystem.token("colors.frontDoor.ground")).toBeTruthy();
      expect(uiDesignSystem.token("colors.frontDoor.action")).toBeTruthy();
      expect(uiDesignSystem.token("colors.frontDoor.onAction")).toBeTruthy();
    });

    // Proves the assertion above discriminates: the foundations alone do not
    // carry these, so the token can only have come from the module's config.
    it("does not get them from the shared foundations", () => {
      const withoutModules = createDesignSystem();

      expect(withoutModules.token("colors.frontDoor.ground")).toBeFalsy();
    });

    it("keeps the shared foundations it composes over", () => {
      expect(uiDesignSystem.token("fonts.heading")).toContain("Sentient");
      expect(uiDesignSystem.token("fonts.mono")).toContain("JetBrains Mono");
    });
  });
});

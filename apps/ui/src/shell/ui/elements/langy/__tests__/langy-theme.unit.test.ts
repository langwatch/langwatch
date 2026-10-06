/**
 * The token half of the panel theme: which semantic tokens carry a Langy value on which ground.
 * @see specs/langy/langy-panel-theme.feature
 */
import { createDesignSystem } from "@langwatch/design-system/system";
import { describe, expect, it } from "vitest";

import { langyThemeConfig } from "../langy-theme.ts";

type Leaf = { value: Record<string, string> };

const colors = langyThemeConfig.theme?.semanticTokens?.colors as Record<
  string,
  Record<string, Leaf>
>;

const leavesOf = (group: string) => Object.entries(colors[group] ?? {});

describe("given the Langy theme merged into the app system", () => {
  const system = createDesignSystem(langyThemeConfig);

  describe("when the panel renders in light mode", () => {
    /** @scenario "Light mode inherits the app's standard palette" */
    it("carries no Langy light value for surfaces, text, borders or accent ramps", () => {
      const inherited = ["bg", "fg", "border", "orange", "purple", "green", "red"];

      for (const group of inherited) {
        const leaves = leavesOf(group);
        expect(leaves.length).toBeGreaterThan(0);
        for (const [name, leaf] of leaves) {
          expect(Object.keys(leaf.value), `${group}.${name}`).not.toContain("_langy");
        }
      }
    });
  });

  describe("when the panel renders in dark mode", () => {
    /** @scenario "Dark mode keeps the ink palette" */
    it("puts the surface on the ink ground and hairlines at white alpha", () => {
      expect(colors.bg?.surface?.value._langyDark).toBe("#141417");
      expect(colors.bg?.panel?.value._langyDark).toBe("#0a0a0c");
      expect(colors.border?.DEFAULT?.value._langyDark).toBe("rgba(255, 255, 255, 0.1)");
      expect(colors.border?.muted?.value._langyDark).toBe("rgba(255, 255, 255, 0.1)");
    });
  });

  describe("when the identity tokens are asked for", () => {
    /** @scenario "The identity tokens exist in both modes" */
    it("resolves every langy.* token and gives it a value on both grounds", () => {
      const identity = leavesOf("langy");

      expect(identity.length).toBeGreaterThan(0);
      for (const [name, leaf] of identity) {
        expect(Object.keys(leaf.value).toSorted(), `langy.${name}`).toEqual([
          "_langy",
          "_langyDark",
        ]);
        expect(system.token(`colors.langy.${name}`), `langy.${name}`).toBeTruthy();
      }
    });
  });
});

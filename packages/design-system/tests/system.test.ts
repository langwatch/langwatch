import { defineConfig } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";

import { createDesignSystem, system } from "../src/system/index.ts";

type TokenLayer = Record<string, Record<string, string>>;

function tokens(value: typeof system): TokenLayer {
  return (value.getTokenCss() as { "@layer tokens": TokenLayer })["@layer tokens"];
}

describe("LangWatch design system", () => {
  /** @scenario The default system contains LangWatch foundations */
  it("emits the packaged foundations and semantic tokens", () => {
    const layer = tokens(system);
    const foundations = layer["&:where(html, .chakra-theme)"] ?? {};
    const light = layer[":root &, .light &"] ?? {};
    const dark = layer[".dark &, .dark .chakra-theme:not(.light) &"] ?? {};

    expect(foundations["--chakra-colors-orange-500"]).toBe("#ED8926");
    expect(light["--chakra-colors-bg-surface"]).toBeDefined();
    expect(dark["--chakra-colors-bg-surface"]).toBeDefined();
    expect(system._config.theme?.recipes?.button).toBeDefined();
    expect(system.getRecipe("sectionNavigationRail")).toBeDefined();
    expect(light["--chakra-colors-nav-bg-selected"]).toContain("--chakra-colors-accent-solid");
    expect(dark["--chakra-colors-nav-bg-selected"]).toContain("--chakra-colors-accent-solid");
    expect(system._config.theme?.slotRecipes?.toast).toBeDefined();
  });

  /** @scenario A feature theme extends without being imported by the design system */
  it("adds feature conditions without replacing base modes", () => {
    const extension = defineConfig({
      conditions: { feature: ".feature &" },
      theme: {
        semanticTokens: {
          colors: {
            bg: {
              surface: { value: { _feature: "rebeccapurple" } },
            },
          },
        },
      },
    });
    const extended = createDesignSystem(extension);
    const layer = tokens(extended);

    expect(layer[":root &, .light &"]?.["--chakra-colors-bg-surface"]).toBeDefined();
    expect(
      layer[".dark &, .dark .chakra-theme:not(.light) &"]?.["--chakra-colors-bg-surface"],
    ).toBeDefined();
    expect(layer[".feature &"]?.["--chakra-colors-bg-surface"]).toBe("rebeccapurple");
  });

  /** @scenario Solid orange stays the brand orange when a feature theme restyles it */
  it("keeps the base orange.solid when an extension sets it for one condition", () => {
    const extension = defineConfig({
      conditions: { feature: ".feature &" },
      theme: {
        semanticTokens: {
          colors: { orange: { solid: { value: { _feature: "#112233" } } } },
        },
      },
    });
    const layer = tokens(createDesignSystem(extension));
    const dark = layer[".dark &, .dark .chakra-theme:not(.light) &"];

    expect(layer[":root &, .light &"]?.["--chakra-colors-orange-solid"]).toBe("#ED8926");
    expect(dark?.["--chakra-colors-orange-solid"]).toBe("#ED8926");
    expect(layer[".feature &"]?.["--chakra-colors-orange-solid"]).toBe("#112233");
  });
});

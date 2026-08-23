import { defineConfig } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";
import { createDesignSystem, system } from "../src/system";

type TokenLayer = Record<string, Record<string, string>>;

function tokens(value: typeof system): TokenLayer {
  return (value.getTokenCss() as { "@layer tokens": TokenLayer })[
    "@layer tokens"
  ];
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
      layer[".dark &, .dark .chakra-theme:not(.light) &"]?.[
        "--chakra-colors-bg-surface"
      ],
    ).toBeDefined();
    expect(layer[".feature &"]?.["--chakra-colors-bg-surface"]).toBe(
      "rebeccapurple",
    );
  });
});

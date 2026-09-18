/**
 * Pins Langy's per-mode palette contract at the token layer.
 * Spec: specs/langy/langy-panel-theme.feature.
 */
import { createSystem, defaultConfig, defineConfig, mergeConfigs } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";

import { langyThemeConfig } from "../langy-theme.ts";

const appConfig = defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        bg: {
          surface: { value: { _light: "white", _dark: "{colors.zinc.950}" } },
        },
      },
    },
  },
});

const system = createSystem(defaultConfig, mergeConfigs(appConfig, langyThemeConfig));

// getTokenCss() emits `{"@layer tokens": {"<selector> &": {--var: value}}}`.
const tokenLayer = (system.getTokenCss() as Record<string, Record<string, Record<string, string>>>)[
  "@layer tokens"
]!;
const langyLight = tokenLayer[".langy-root &"] ?? {};
const langyDark = tokenLayer[".dark .langy-root &"] ?? {};

describe("langyTheme token emission", () => {
  describe("given the app system merged with Langy's config", () => {
    /** @scenario Light mode inherits the app's standard palette */
    it("keeps the app's own bg.surface for the light panel", () => {
      // The app's light value survives the merge untouched...
      const appLight = tokenLayer[":root &, .light &"] ?? {};
      expect(appLight["--chakra-colors-bg-surface"]).toBe("white");
      // ...and Langy's light condition does not shadow it.
      expect(langyLight["--chakra-colors-bg-surface"]).toBeUndefined();
    });

    it("does not override surfaces, text, borders or accents in Langy light", () => {
      const overridden = Object.keys(langyLight).filter(
        (variable) =>
          !variable.startsWith("--chakra-colors-langy-") &&
          !variable.startsWith("--chakra-font-sizes-") &&
          variable !== "--chakra-shadows-langy-card",
      );
      expect(overridden).toEqual([]);
    });

    /** @scenario Dark mode keeps the ink palette */
    it("overrides the surface to the ink ground in Langy dark", () => {
      expect(langyDark["--chakra-colors-bg-surface"]).toBe("#141417");
      expect(langyDark["--chakra-colors-border"]).toBe("rgba(255, 255, 255, 0.1)");
      expect(langyDark["--chakra-colors-fg"]).toBe("#ffffff");
    });

    /** @scenario The identity tokens exist in both modes */
    it("resolves the langy.* identity namespace on both grounds", () => {
      expect(langyLight["--chakra-colors-langy-ai-blue"]).toBe("#5b8def");
      expect(langyDark["--chakra-colors-langy-ai-blue"]).toBe("#5fa3ff");
      expect(langyLight["--chakra-colors-langy-bar-fill"]).toBe("rgba(245, 107, 26, 0.75)");
      expect(langyDark["--chakra-colors-langy-bar-fill"]).toBe("rgba(255, 179, 128, 0.7)");
    });

    it("keeps the panel's type scale on both grounds", () => {
      expect(langyLight["--chakra-font-sizes-sm"]).toBe("0.8125rem");
      expect(langyDark["--chakra-font-sizes-sm"]).toBe("0.8125rem");
    });
  });
});

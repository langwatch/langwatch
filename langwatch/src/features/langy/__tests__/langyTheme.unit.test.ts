/**
 * Pins Langy's per-mode palette contract at the token layer (spec:
 * specs/langy/langy-panel-theme.feature).
 *
 * The system here is built the same way _app.tsx builds the real one,
 * `createSystem(defaultConfig, mergeConfigs(app tokens, langyThemeConfig))`,
 * with the app config reduced to the one token the contract turns on:
 * `bg.surface` with the app's own `_light` / `_dark` values. The assertions
 * run against the CSS the system actually emits, so they hold exactly when
 * the browser behaviour holds:
 *
 *   - LIGHT INHERITS THE APP. `.langy-root` carries no surface/text/border
 *     or accent-ramp override, so the app's light values apply unchanged
 *     inside the panel.
 *   - DARK IS INK. `.dark .langy-root` overrides the surface to the ink
 *     ground, at higher specificity than `.dark` itself.
 *   - THE IDENTITY NAMESPACE EXISTS IN BOTH. `langy.*` has no app fallback,
 *     so it must resolve on both grounds, along with the panel's type scale.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSystem,
  defaultConfig,
  defineConfig,
  mergeConfigs,
} from "@chakra-ui/react";
import { describe, expect, it } from "vitest";
import { langyThemeConfig } from "../langyTheme";

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

const system = createSystem(
  defaultConfig,
  mergeConfigs(appConfig, langyThemeConfig),
);

// getTokenCss() emits `{"@layer tokens": {"<selector> &": {--var: value}}}`.
const tokenLayer = (
  system.getTokenCss() as Record<string, Record<string, Record<string, string>>>
)["@layer tokens"]!;
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
      expect(langyDark["--chakra-colors-border"]).toBe(
        "rgba(255, 255, 255, 0.1)",
      );
      expect(langyDark["--chakra-colors-fg"]).toBe("#ffffff");
    });

    /** @scenario The identity tokens exist in both modes */
    it("resolves the langy.* identity namespace on both grounds", () => {
      expect(langyLight["--chakra-colors-langy-ai-blue"]).toBe("#5b8def");
      expect(langyDark["--chakra-colors-langy-ai-blue"]).toBe("#5fa3ff");
      expect(langyLight["--chakra-colors-langy-bar-fill"]).toBe(
        "rgba(245, 107, 26, 0.75)",
      );
      expect(langyDark["--chakra-colors-langy-bar-fill"]).toBe(
        "rgba(255, 179, 128, 0.7)",
      );
    });

    it("keeps the panel's type scale on both grounds", () => {
      expect(langyLight["--chakra-font-sizes-sm"]).toBe("0.8125rem");
      expect(langyDark["--chakra-font-sizes-sm"]).toBe("0.8125rem");
    });
  });

  describe("given the panel's ambient textures in langyTheme.css", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../langyTheme.css", import.meta.url)),
      "utf8",
    );
    // One rule per selector in the sheet, so anchoring on the selector and
    // reading to the closing brace captures that rule's whole body.
    const ruleBody = (selector: string) => {
      const start = css.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };

    /** @scenario Ambient textures are a dark-mode treatment */
    it("hides the wash and signal grid until the dark gate turns them on", () => {
      // Both textures ship hidden, so the light panel stays the app's clean
      // surface...
      expect(ruleBody(".langy-wash {")).toContain("display: none");
      expect(ruleBody(".langy-signal-grid {")).toContain("display: none");
      // ...and only the .dark gate reveals them on the ink ground.
      expect(ruleBody(".dark .langy-root .langy-wash")).toContain(
        "display: block",
      );
      expect(ruleBody(".dark .langy-signal-grid")).toContain("display: block");
      // The film-grain overlay is gone from both grounds, not merely gated.
      expect(css).not.toContain(".langy-grain");
    });
  });
});

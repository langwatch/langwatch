/** @see specs/langy/langy-panel-theme.feature */
import { createDesignSystem } from "@langwatch/design-system/system";
import { describe, expect, it } from "vitest";

import { langyThemeConfig } from "../langy-theme.ts";

const base = createDesignSystem();
const system = createDesignSystem(langyThemeConfig);
const css = system.getTokenCss() as Record<string, Record<string, Record<string, string>>>;
const baseCss = base.getTokenCss() as typeof css;

describe("Langy palette", () => {
  it("inherits the app surfaces, text, borders and status colours in both modes", () => {
    for (const [selector, values] of Object.entries(baseCss["@layer tokens"] ?? {})) {
      const shared = Object.entries(values).filter(([name]) =>
        /^--chakra-colors-(bg|fg|border|orange|purple|green|red)(-|$)/.test(name),
      );
      for (const [name, value] of shared) {
        expect(css["@layer tokens"]?.[selector]?.[name], `${selector}: ${name}`).toBe(value);
      }
    }
    expect(Object.keys(langyThemeConfig.theme?.semanticTokens?.colors ?? {})).toEqual(["langy"]);
  });

  it("emits identity colours and semantic aliases for the data and conversation surfaces", () => {
    const emitted = Object.assign({}, ...Object.values(css["@layer tokens"] ?? {}));
    expect(emitted["--chakra-colors-langy-ai-blue"]).toBeTruthy();
    expect(emitted["--chakra-colors-langy-ai-purple"]).toBeTruthy();
    expect(emitted["--chakra-colors-langy-ai-orange"]).toBeTruthy();
    expect(emitted["--chakra-colors-langy-bar-track"]).toBe("var(--chakra-colors-bg-control)");
    expect(emitted["--chakra-colors-langy-answer-fg"]).toBe("var(--chakra-colors-fg-muted)");
    expect(emitted["--chakra-colors-langy-user-bubble-bg"]).toBe("var(--chakra-colors-bg-nested)");
  });
});

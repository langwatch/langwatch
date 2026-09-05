// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ColorModeProvider } from "../src/color-mode";

// jsdom ships no matchMedia, and next-themes reads it on mount. Answer as a
// reader who has asked for less motion.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && !query.includes("no-preference"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => cleanup());

/**
 * The colour-mode cross-fade is decoration. A reader who has asked for less
 * motion still gets the appearance change — it just arrives without the
 * transition, which is what the media-query scope buys: the rule never applies
 * rather than applying and then being undone.
 */
describe("ColorModeProvider", () => {
  function injectedStyle(): string {
    const { container } = render(
      <ColorModeProvider>
        <div />
      </ColorModeProvider>,
    );
    const style = container.querySelector("style");
    expect(style).not.toBeNull();
    return style?.textContent ?? "";
  }

  describe("given the user prefers reduced motion", () => {
    /** @scenario Appearance changes respect reduced motion */
    it("declares its colour transitions only where motion is welcome", () => {
      const css = injectedStyle();

      // Every transition it declares sits inside the no-preference query, so a
      // reduced-motion reader matches none of them.
      expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
      const outsideQuery = css.slice(0, css.indexOf("@media"));
      expect(outsideQuery).not.toContain("transition");
    });
  });
});

import { describe, expect, it } from "vitest";

import { darkFallbackCss, darkFallbackHead } from "../dark-fallback.ts";
import { parseStylesheet } from "../stylesheet.ts";

describe("darkFallbackCss", () => {
  describe("when the shared stylesheet holds dark-theme rules", () => {
    const css = darkFallbackCss({
      nodes: parseStylesheet({
        css: [
          "@layer reset,tokens;",
          "@keyframes spin{to{rotate:1turn}}",
          "@layer tokens{:root{--bg:#fff}.dark,.dark .chakra-theme:not(.light){--bg:#141417}}",
          ".dark .docs-light-only,.docs-dark-only{display:none}",
          ".docs-dark-mode,.dark-panel{color:red}",
          "@media (hover:hover){.dark .css-a:hover{color:#fff}}",
        ].join(""),
      }),
    });

    /** @scenario "Follow the reader's dark preference without JavaScript" */
    it("repeats each dark rule for a document without a theme class", () => {
      expect(css).toBe(
        ":root{color-scheme:dark}@layer tokens{:root:where(:not(.light)),:root:where(:not(.light)) .chakra-theme:not(.light){--bg:#141417}}:root:where(:not(.light)) .docs-light-only{display:none}@media (hover:hover){:root:where(:not(.light)) .css-a:hover{color:#fff}}",
      );
    });

    /** @scenario "Follow the reader's dark preference without JavaScript" */
    it("links it only for readers without JavaScript who prefer dark", () => {
      expect(darkFallbackHead({ href: "/docs/assets/docs-dark-1.css" })).toBe(
        '<noscript><link rel="stylesheet" href="/docs/assets/docs-dark-1.css" media="(prefers-color-scheme: dark)"></noscript>',
      );
    });
  });
});

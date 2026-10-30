import { describe, expect, it } from "vitest";

import { minifyCss } from "../minify.ts";
import { inlinePageStyles } from "../page-styles.ts";

describe("minifyCss", () => {
  describe("when emitted rules repeat and carry vendor prefixes", () => {
    const css = minifyCss({
      css: [
        ".css-a { display: -webkit-box; display: -webkit-flex; display: -ms-flexbox; display: flex; }",
        ".css-a { display: -webkit-box; display: -webkit-flex; display: -ms-flexbox; display: flex; }",
        ".css-b { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }",
        ".css-c { -webkit-line-clamp: 2; -webkit-box-orient: vertical; display: -webkit-box; }",
      ].join("\n"),
    });

    /** @scenario "Minify the shared stylesheet for the supported browsers" */
    it("removes duplicates and prefixes the supported browsers no longer need", () => {
      expect(css.match(/\.css-a/g)).toHaveLength(1);
      expect(css).toContain(".css-a{display:flex}");
    });

    /** @scenario "Minify the shared stylesheet for the supported browsers" */
    it("keeps the prefixes those browsers still need", () => {
      expect(css).toContain("-webkit-backdrop-filter:blur(4px)");
      expect(css).toContain("-webkit-line-clamp:2");
      expect(css).toContain("display:-webkit-box");
    });
  });

  describe("when the shared stylesheet's contents change", () => {
    /** @scenario "Minify the shared stylesheet for the supported browsers" */
    it("changes its file name", () => {
      const sheet = ({ rule }: { rule: string }) =>
        inlinePageStyles({
          rules: [rule],
          clientCss: [],
          clientLinks: [],
          scripts: [],
          pages: new Map(),
          placeholder: "",
          href: (file) => file,
        }).file;
      expect(sheet({ rule: ".a{color:red}" })).not.toBe(sheet({ rule: ".a{color:blue}" }));
    });
  });
});

import { describe, expect, it } from "vitest";

import { criticalCss, markupNames, scriptedNames } from "../critical.ts";
import { inlinePageStyles, styleHead } from "../page-styles.ts";
import { parseStylesheet, serializeStylesheet } from "../stylesheet.ts";

const SHEET = [
  "@layer reset,recipes;",
  "@font-face{font-family:Inter;src:url(/fonts/inter.woff2)}",
  "@keyframes spin{to{transform:rotate(1turn)}}",
  ":root{--paper:#fff;--ink:var(--ink-base);--ink-base:#111;--unused:red;--menu:#eee}",
  ".dark{--paper:#000}",
  "@layer recipes{.css-here{color:var(--ink)}.css-there{color:blue}}",
  ".css-here:not(.css-there){margin:0}",
  ".dark .css-here,.css-there{background:var(--paper)}",
  ":where(.css-there) p{padding:0}",
  "#guide-intro{scroll-margin:4px}#other-page{scroll-margin:8px}",
  "@media (prefers-reduced-motion:reduce){.css-there{animation:none}}",
  ".docs-menu{background:var(--menu)}",
  ".docs-nav-indicator{height:2px}",
  "a{color:inherit}",
].join("");

function pageStyles({ html, scripts = [] }: { html: string; scripts?: string[] }) {
  const other = '<div class="css-there docs-nav-indicator" id="other-page"></div>';
  const known = new Set([...markupNames({ html }), ...markupNames({ html: other })]);
  return criticalCss({
    nodes: parseStylesheet({ css: SHEET }),
    page: markupNames({ html }),
    known,
    scripted: scriptedNames({ known, scripts }),
    mentioned: new Set(),
  });
}

describe("parseStylesheet", () => {
  describe("when a stylesheet is parsed and written back", () => {
    it("reproduces it exactly", () => {
      expect(serializeStylesheet({ nodes: parseStylesheet({ css: SHEET }) })).toBe(SHEET);
    });
  });

  describe("when a selector or value holds braces, semicolons or commas in strings", () => {
    it("keeps them inside their rule", () => {
      const css = '.a[title="x{;}"]{content:"}{;"}.b{color:red}';
      const nodes = parseStylesheet({ css });
      expect(nodes.map((node) => (node.kind === "rule" ? node.selector : ""))).toEqual([
        '.a[title="x{;}"]',
        ".b",
      ]);
    });
  });
});

describe("criticalCss", () => {
  /** @scenario "Paint a page from its own styles without waiting for a stylesheet" */
  describe("when a page carries some of the site's classes and ids", () => {
    const css = pageStyles({ html: '<main class="css-here" id="guide-intro"></main>' });

    it("keeps the rules its markup can match", () => {
      expect(css).toContain(".css-here{color:var(--ink)}");
      expect(css).toContain(".css-here:not(.css-there){margin:0}");
      expect(css).toContain("#guide-intro{scroll-margin:4px}");
    });

    it("leaves out rules for classes and ids found only on other pages", () => {
      expect(css).not.toContain(".css-there{color:blue}");
      expect(css).not.toContain("#other-page");
      expect(css).not.toContain("prefers-reduced-motion");
      expect(css).not.toContain(".docs-nav-indicator");
    });

    it("keeps theme rules, unscoped rules, at-rules and rules for names no page carries", () => {
      expect(css).toContain(".dark .css-here,.css-there{background:var(--paper)}");
      expect(css).toContain(".dark{--paper:#000}");
      expect(css).toContain(":where(.css-there) p{padding:0}");
      expect(css).toContain("a{color:inherit}");
      expect(css).toContain(".docs-menu{background:var(--menu)}");
      expect(css).toContain("@layer reset,recipes;");
      expect(css).toContain("@font-face{font-family:Inter");
      expect(css).toContain("@keyframes spin");
    });

    it("keeps only the custom properties a kept rule reads, directly or through another", () => {
      expect(css).toContain(
        ":root{--paper:#fff;--ink:var(--ink-base);--ink-base:#111;--menu:#eee}",
      );
      expect(css).not.toContain("--unused");
    });
  });

  describe("when a client bundle names a class some other page carries", () => {
    it("keeps its rules on every page, since an island may add it at runtime", () => {
      const css = pageStyles({
        html: '<main class="css-here"></main>',
        scripts: ['marker.className="docs-nav-indicator"'],
      });
      expect(css).toContain(".docs-nav-indicator{height:2px}");
    });
  });
});

describe("inlinePageStyles", () => {
  /** @scenario "Paint a page from its own styles without waiting for a stylesheet" */
  describe("when pages are assembled with a client stylesheet", () => {
    const placeholder = '<link data-docs-style rel="stylesheet" href="/assets/prerender.css">';
    const clientLink = '<link rel="stylesheet" crossorigin href="/assets/index-a.css">';
    const page = `<html><head>${placeholder}${clientLink}</head><body><main class="css-here"></main></body></html>`;
    const result = inlinePageStyles({
      rules: ["@layer recipes{.css-here{color:red}.css-there{color:blue}}"],
      clientCss: [".docs-shell{display:grid}"],
      clientLinks: [clientLink],
      scripts: [],
      pages: new Map([
        ["index.html", page],
        ["other/index.html", page.replace("css-here", "css-there docs-shell")],
      ]),
      placeholder,
      href: (file) => `/docs/${file}`,
    });
    const home = result.pages.get("index.html") ?? "";

    it("inlines the page's rules and links the shared sheet without blocking", () => {
      expect(home).toContain(
        styleHead({ css: "@layer recipes{.css-here{color:red}}", href: `/docs/${result.file}` }),
      );
      expect(home).toContain('media="print" onload="this.media=\'all\'"');
      expect(home).not.toContain(placeholder);
      expect(home).not.toContain(clientLink);
    });

    it("writes one hashed shared sheet holding every server and client rule", () => {
      expect(result.file).toMatch(/^assets\/docs-[0-9a-f]{16}\.css$/);
      const css = result.files.get(result.file) ?? "";
      expect(css).toContain(".css-there");
      expect(css).toContain(".docs-shell");
    });
  });
});

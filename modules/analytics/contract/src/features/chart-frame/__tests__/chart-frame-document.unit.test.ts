/**
 * The document the sandboxed chart frame runs, read as text: what it stamps on
 * its own inline scripts, and what it refuses to stamp.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it } from "vitest";

import { assertChartFrameNonce, buildChartFrameDocument } from "../chart-frame-document.ts";
import { CHART_FRAME_BUILTIN_MODULES } from "../chart-frame-import-specifier.ts";

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)([^>]*)>/g;

function inlineScriptTags(document: string): string[] {
  return [...document.matchAll(INLINE_SCRIPT)].map(([, attributes]) => attributes ?? "");
}

describe("the chart frame document", () => {
  describe("when a response nonce is given", () => {
    /** @scenario "The frame's own inline scripts survive a nonce added upstream" */
    it("stamps it on every inline script, the import map included", () => {
      const document = buildChartFrameDocument({ nonce: "n0nce+VALUE/=" });

      const tags = inlineScriptTags(document);

      expect(tags.length).toBeGreaterThanOrEqual(4);
      for (const attributes of tags) {
        expect(attributes).toContain('nonce="n0nce+VALUE/="');
      }
    });

    it("refuses one that could close the attribute it is written into", () => {
      expect(() => buildChartFrameDocument({ nonce: '"><script>alert(1)</script>' })).toThrow(
        /invalid chart frame nonce/,
      );
      expect(() => assertChartFrameNonce("has space")).toThrow(/invalid chart frame nonce/);
    });
  });

  describe("when no nonce is given", () => {
    it("writes bare inline scripts, as a srcdoc frame under the app policy needs", () => {
      const document = buildChartFrameDocument();

      for (const attributes of inlineScriptTags(document)) {
        expect(attributes).not.toContain("nonce");
      }
    });
  });

  describe("when the libraries it loads are read", () => {
    const document = buildChartFrameDocument({ nonce: "abc" });

    it("loads React, ReactDOM, Recharts and Babel from their pinned script tags", () => {
      expect(document).toContain("unpkg.com/react@");
      expect(document).toContain("unpkg.com/react-dom@");
      expect(document).toContain("unpkg.com/recharts@");
      expect(document).toContain("unpkg.com/@babel/standalone@");
    });

    it("pins the versions the import map's export names were recorded from", () => {
      expect(document).toContain("unpkg.com/react@18.3.1/");
      expect(document).toContain("unpkg.com/react-dom@18.3.1/");
      expect(document).toContain("unpkg.com/recharts@2.15.4/");
    });

    /** @scenario "The frame's own inline scripts survive a nonce added upstream" */
    it("stamps no nonce on an external script, which the policy admits by origin", () => {
      const external = [...document.matchAll(/<script[^>]*\bsrc=[^>]*>/g)].map(([tag]) => tag);

      expect(external.length).toBeGreaterThan(0);
      for (const tag of external) expect(tag).not.toContain("nonce=");
    });
  });

  describe("when its import map is read", () => {
    const document = buildChartFrameDocument({ nonce: "abc" });
    const head = document.slice(document.indexOf("<head>") + "<head>".length);

    /** @scenario "A custom widget that imports recharts renders in Chromium, WebKit and Firefox" */
    it("opens the head with it, ahead of every script, stylesheet and preload", () => {
      expect(head.startsWith('<script type="importmap" nonce="abc">')).toBe(true);

      const firstOther = document.search(/<(?:script(?! type="importmap")|link|style)\b/);
      expect(document.indexOf('<script type="importmap"')).toBeLessThan(firstOther);
      expect(document.match(/<script type="importmap"/g)).toHaveLength(1);
    });

    /** @scenario "A custom widget that imports recharts renders in Chromium, WebKit and Firefox" */
    it("maps every built-in specifier to a module of its own", () => {
      const json = head.slice(head.indexOf(">") + 1, head.indexOf("</script>"));
      const { imports } = JSON.parse(json) as { imports: Record<string, string> };

      expect(Object.keys(imports).toSorted()).toEqual([...CHART_FRAME_BUILTIN_MODULES].toSorted());
      for (const url of Object.values(imports)) {
        expect(url.startsWith("data:text/javascript;charset=utf-8,")).toBe(true);
      }
    });

    /** @scenario "A custom widget that imports recharts renders in Chromium, WebKit and Firefox" */
    it("leaves no script that builds an import map once the document is running", () => {
      const afterMap = head.slice(head.indexOf("</script>"));

      expect(afterMap).not.toContain("importmap");
    });
  });

  /** @scenario "The frame document carries no widget source" */
  it("carries no author code, whoever asks for it", () => {
    const document = buildChartFrameDocument({ nonce: "abc" });

    expect(document).toContain('<div id="lw-root"></div>');
    expect(document).not.toContain("lw:widget-source");
    expect(document).toContain("lw:init");
  });
});

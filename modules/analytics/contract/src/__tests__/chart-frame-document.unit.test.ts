/**
 * The document the sandboxed chart frame runs, read as text: what it stamps on
 * its own inline scripts, and what it refuses to stamp.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it } from "vitest";

import { assertChartFrameNonce, buildChartFrameDocument } from "../chart-frame-document.ts";

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
      expect(document).toContain("cur.nonce");
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
        expect(attributes.trim()).toBe("");
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

    it("maps react/jsx-runtime in the import map", () => {
      expect(document).toContain("react/jsx-runtime");
    });

    /** @scenario "The frame's own inline scripts survive a nonce added upstream" */
    it("stamps no nonce on an external script, which the policy admits by origin", () => {
      const external = [...document.matchAll(/<script[^>]*\bsrc=[^>]*>/g)].map(([tag]) => tag);

      expect(external.length).toBeGreaterThan(0);
      for (const tag of external) expect(tag).not.toContain("nonce=");
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

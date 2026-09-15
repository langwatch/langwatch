/**
 * The sandboxed chart-frame document's own route, headers and body.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it } from "vitest";

import {
  buildChartFrameHeaders,
  buildChartFrameHtml,
  CHART_FRAME_PATH,
} from "../chartSandboxFrame";

function directive(csp: string, name: string): string {
  const found = csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`directive ${name} not found in CSP`);
  return found;
}

describe("given the chart sandbox frame route", () => {
  describe("when the frame document's response headers are built", () => {
    const headers = buildChartFrameHeaders();
    const csp = headers["Content-Security-Policy"] ?? "";

    /** @scenario "The frame document is served on its own route with its own policy" */
    it("serves the frame document at /sandbox/chart-frame", () => {
      expect(CHART_FRAME_PATH).toBe("/sandbox/chart-frame");
    });

    /** @scenario "The frame document is served on its own route with its own policy" */
    it("lets script-src load any https origin, blob: and data:", () => {
      const scriptSrc = directive(csp, "script-src");
      expect(scriptSrc).toContain("https:");
      expect(scriptSrc).toContain("blob:");
      expect(scriptSrc).toContain("data:");
    });

    /** @scenario "The frame document is served on its own route with its own policy" */
    it("lets style-src, font-src, img-src and connect-src load any https origin", () => {
      for (const name of ["style-src", "font-src", "img-src", "connect-src"]) {
        expect(directive(csp, name)).toContain("https:");
      }
    });

    /** @scenario "The frame document is served on its own route with its own policy" */
    it("keeps frame-ancestors 'self' and X-Frame-Options SAMEORIGIN", () => {
      expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
      expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    });

    /** @scenario "The frame document is served on its own route with its own policy" */
    it("never caches the response", () => {
      expect(headers["Cache-Control"]).toMatch(/no-store/);
    });

    /** @scenario "The frame document is sandboxed even when opened directly" */
    it("sandboxes the document via CSP so a direct navigation is opaque-origin too", () => {
      expect(directive(csp, "sandbox")).toBe("sandbox allow-scripts");
    });
  });

  describe("when the chart frame document is built", () => {
    const html = buildChartFrameHtml();

    /** @scenario "The frame document carries no widget source" */
    it("contains the React, ReactDOM, Recharts and Babel script tags", () => {
      expect(html).toContain("unpkg.com/react@");
      expect(html).toContain("unpkg.com/react-dom@");
      expect(html).toContain("unpkg.com/recharts@");
      expect(html).toContain("unpkg.com/@babel/standalone@");
    });

    /** @scenario "The frame document carries no widget source" */
    it("contains the shim, charts library and author runtime scripts, plus the import map", () => {
      expect(html).toContain("window.LW");
      expect(html).toContain("LWCharts");
      expect(html).toContain("__lwActivateAuthor");
      expect(html).toContain("importmap");
    });

    /** @scenario "A package built with the automatic JSX runtime shares the frame's React" */
    it("contains react/jsx-runtime in the import map", () => {
      expect(html).toContain("react/jsx-runtime");
    });

    /** @scenario "The frame document carries no widget source" */
    it("bakes in no widget source", () => {
      // The document takes no code argument at all, and no build-time string
      // literal is ever assigned to __LW_AUTHOR_SOURCE__ (the shim only ever
      // assigns it from the runtime lw:init value).
      expect(buildChartFrameHtml.length).toBe(0);
      expect(html).not.toMatch(/__LW_AUTHOR_SOURCE__\s*=\s*"/);
    });
  });
});

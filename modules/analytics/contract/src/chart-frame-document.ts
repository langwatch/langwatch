/**
 * The sandboxed frame's document: the import map first, then CDN UMD tags, the
 * shim, the author runtime. No author code, and only strings, so the process
 * that serves it calls it too.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { buildAuthorRuntimeScript } from "./chart-frame-author-runtime.ts";
import { buildChartsLibScript } from "./chart-frame-charts-lib-source.ts";
import { buildChartFrameImportMap } from "./chart-frame-import-map.ts";
import { buildShimScript } from "./chart-frame-shim-source.ts";

/**
 * Pinned exactly, so UNPKG never resolves a newer release under a saved widget.
 * React 19 dropped the UMD build, so the sandbox stays on 18 and Recharts 2.
 * A new pin means re-recording the export names in chart-frame-import-map.ts.
 */
const CDN_SCRIPTS_BEFORE_CHARTS_LIB = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/prop-types@15.8.1/prop-types.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://unpkg.com/recharts@2.15.4/umd/Recharts.js",
];
const CDN_SCRIPTS_AFTER_CHARTS_LIB = ["https://unpkg.com/@babel/standalone@7.29.8/babel.min.js"];

/**
 * A nonce becomes an HTML attribute value, so it must not be able to close the
 * `nonce="…"` attribute or inject markup: only the base64/URL-safe alphabet a
 * generated nonce is drawn from.
 */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

export function assertChartFrameNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error(`invalid chart frame nonce: ${JSON.stringify(nonce)}`);
  }
}

/**
 * The document, every inline script carrying the caller's nonce. An edge proxy
 * appending its own `'nonce-…'` makes `'unsafe-inline'` ignored, so a served
 * response passes one; a `srcdoc` frame inherits the app policy and passes none.
 */
export function buildChartFrameDocument(options: { nonce?: string } = {}): string {
  const { nonce } = options;
  if (nonce !== void 0) {
    assertChartFrameNonce(nonce);
  }
  const inline = nonce === void 0 ? "<script>" : `<script nonce="${nonce}">`;
  const importMap =
    nonce === void 0 ? '<script type="importmap">' : `<script type="importmap" nonce="${nonce}">`;

  return [
    "<!doctype html>",
    // First in the head, as markup: an engine that has started loading any
    // module ignores a later import map, and a proxy may inject a module script.
    `<html><head>${importMap}${JSON.stringify(buildChartFrameImportMap())}</script>`,
    '<meta charset="utf-8">',
    "<style>",
    "  html, body { height: 100%; }",
    "  body {",
    "    margin: 0; padding: 8px; box-sizing: border-box;",
    "    font-family: system-ui, sans-serif; font-size: 13px;",
    "  }",
    // The widget's root fills whatever height the parent gave the iframe —
    // a widget wraps its own layout in height: 100% (and, for a chart,
    // ResponsiveContainer height="100%") to actually fill it rather than
    // being sized to a fixed pixel guess.
    "  #lw-root { height: 100%; }",
    "  #lw-compile-error {",
    "    display: none; white-space: pre-wrap; font-family: ui-monospace, monospace;",
    "    font-size: 12px; color: #b91c1c; background: #fef2f2;",
    "    border: 1px solid #fecaca; border-radius: 6px; padding: 8px; margin: 0;",
    "  }",
    "</style>",
    ...CDN_SCRIPTS_BEFORE_CHARTS_LIB.map((src) => `<script src="${src}" crossorigin></script>`),
    `${inline}${buildChartsLibScript()}</script>`,
    ...CDN_SCRIPTS_AFTER_CHARTS_LIB.map((src) => `<script src="${src}" crossorigin></script>`),
    "</head><body>",
    '<div id="lw-root"></div>',
    '<pre id="lw-compile-error"></pre>',
    `${inline}${buildShimScript()}</script>`,
    `${inline}${buildAuthorRuntimeScript()}</script>`,
    "</body></html>",
  ].join("\n");
}

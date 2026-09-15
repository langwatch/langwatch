/**
 * Composes the sandboxed frame's document. React, ReactDOM, Recharts and
 * Babel load standalone from a CDN as render-blocking UMD `<script>` tags,
 * so their globals are already there by the time the shim and author
 * runtime run. The widget's source is embedded as a JS string, not markup —
 * it's a React/TSX file, compiled and mounted by the shim after `lw:init`.
 */

import { buildAuthorRuntimeScript } from "./authorRuntime";
import { buildChartsLibScript } from "./chartsLibSource";
import { buildShimScript } from "./shimSource";

/**
 * Pinned to exact versions (not ranges) so UNPKG can never resolve a newer
 * release out from under a saved widget, and lower than the app's own
 * React/Recharts: React 19 dropped the UMD build these `<script>` tags need,
 * so the sandbox stays on the last UMD-shipping majors — 18 and recharts 2.
 */
const CDN_SCRIPTS_BEFORE_CHARTS_LIB = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/prop-types@15.8.1/prop-types.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://unpkg.com/recharts@2.15.4/umd/Recharts.js",
];
const CDN_SCRIPTS_AFTER_CHARTS_LIB = [
  "https://unpkg.com/@babel/standalone@7.29.8/babel.min.js",
];

/**
 * Embeds `source` as a JS string literal safe to inline inside a `<script>`
 * element. `JSON.stringify` handles quoting and control characters; the one
 * thing it does not know about is HTML: a literal `</script` inside the
 * string would close the element early regardless of the JS syntax around
 * it, since the HTML tokenizer never looks at JS semantics. That is the only
 * sequence guarded here.
 */
function toInlineScriptLiteral(source: string): string {
  return JSON.stringify(source).replace(/<\/script/gi, "<\\/script");
}

export function buildSrcdoc(code: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
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
    ...CDN_SCRIPTS_BEFORE_CHARTS_LIB.map(
      (src) => `<script src="${src}" crossorigin></script>`,
    ),
    `<script>${buildChartsLibScript()}</script>`,
    ...CDN_SCRIPTS_AFTER_CHARTS_LIB.map(
      (src) => `<script src="${src}" crossorigin></script>`,
    ),
    "</head><body>",
    '<div id="lw-root"></div>',
    '<pre id="lw-compile-error"></pre>',
    `<script>${buildShimScript()}</script>`,
    `<script>window.__LW_AUTHOR_SOURCE__ = ${toInlineScriptLiteral(code)};</script>`,
    `<script>${buildAuthorRuntimeScript()}</script>`,
    "</body></html>",
  ].join("\n");
}

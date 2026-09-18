/**
 * Composes the sandboxed frame's document. React, ReactDOM, Recharts and
 * Babel load standalone from a CDN as UMD `<script>` tags before the shim
 * runs. The widget's source embeds as a JS string, compiled after `lw:init`.
 */

import { buildAuthorRuntimeScript } from "./author-runtime";
import { buildChartsLibScript } from "./charts-lib-source";
import { buildShimScript } from "./shim-source";

/**
 * Pinned to exact versions so UNPKG can never resolve a newer release out
 * from under a saved widget. React 19 dropped the UMD build these tags
 * need, so the sandbox stays on the last UMD-shipping majors: 18 and 2.
 */
const CDN_SCRIPTS_BEFORE_CHARTS_LIB = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/prop-types@15.8.1/prop-types.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://unpkg.com/recharts@2.15.4/umd/Recharts.js",
];
const CDN_SCRIPTS_AFTER_CHARTS_LIB = ["https://unpkg.com/@babel/standalone@7.29.8/babel.min.js"];

/**
 * Embeds `source` as a JS string literal safe to inline in a `<script>`
 * tag. `JSON.stringify` handles quoting, but not HTML: a literal
 * `</script` inside the string would close the element regardless of JS syntax.
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
    ...CDN_SCRIPTS_BEFORE_CHARTS_LIB.map((src) => `<script src="${src}" crossorigin></script>`),
    `<script>${buildChartsLibScript()}</script>`,
    ...CDN_SCRIPTS_AFTER_CHARTS_LIB.map((src) => `<script src="${src}" crossorigin></script>`),
    "</head><body>",
    '<div id="lw-root"></div>',
    '<pre id="lw-compile-error"></pre>',
    `<script>${buildShimScript()}</script>`,
    `<script>window.__LW_AUTHOR_SOURCE__ = ${toInlineScriptLiteral(code)};</script>`,
    `<script>${buildAuthorRuntimeScript()}</script>`,
    "</body></html>",
  ].join("\n");
}

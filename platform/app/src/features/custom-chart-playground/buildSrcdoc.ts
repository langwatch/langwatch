/**
 * Composes the sandboxed frame's document.
 *
 * The frame loads React, ReactDOM, Recharts and Babel standalone from a CDN
 * as plain UMD `<script>` tags — render-blocking, so by the time the shim and
 * author runtime run, the globals they read (`window.React`, and so on) are
 * already there. The widget's own source is embedded as a JS string constant
 * rather than markup: it is a React/TSX file, not HTML, and the shim's
 * `window.__lwActivateAuthor` hook (wired up by `bridge/authorRuntime.ts`)
 * is what compiles and mounts it, only after `lw:init`.
 */

import { buildAuthorRuntimeScript } from "./bridge/authorRuntime";
import { buildShimScript } from "./bridge/shimSource";

/**
 * Pinned versions so a CDN release never silently changes what a saved
 * widget compiles against. React 18's UMD build is the one that added
 * `ReactDOM.createRoot`, and Recharts' UMD reads `window.PropTypes` as a
 * plain global rather than requiring it — hence prop-types loading first.
 */
const CDN_SCRIPTS = [
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/prop-types@15/prop-types.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/recharts@2/umd/Recharts.js",
  "https://unpkg.com/@babel/standalone@7/babel.min.js",
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
    ...CDN_SCRIPTS.map((src) => `<script src="${src}" crossorigin></script>`),
    "</head><body>",
    '<div id="lw-root"></div>',
    '<pre id="lw-compile-error"></pre>',
    `<script>${buildShimScript()}</script>`,
    `<script>window.__LW_AUTHOR_SOURCE__ = ${toInlineScriptLiteral(code)};</script>`,
    `<script>${buildAuthorRuntimeScript()}</script>`,
    "</body></html>",
  ].join("\n");
}

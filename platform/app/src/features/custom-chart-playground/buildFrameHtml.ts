/**
 * Composes the sandboxed chart-frame document.
 *
 * No longer an iframe `srcdoc`: the document is served as a static response
 * from `CHART_FRAME_PATH` (see `~/server/chartSandboxFrame`), which gives it
 * its own permissive Content-Security-Policy instead of inheriting the
 * app-wide one — that inheritance is exactly what blocked the CDN scripts in
 * production. Because the document is shared by every widget and carries no
 * author code, the widget's own source now arrives over the `lw:init`
 * postMessage (see `bridge/shimSource.ts`) rather than being embedded here.
 *
 * The frame loads React, ReactDOM, Recharts and Babel standalone from a CDN
 * as plain UMD `<script>` tags — render-blocking, so by the time the shim and
 * author runtime run, the globals they read (`window.React`, and so on) are
 * already there. An import map (built from those same UMD globals) is inserted
 * after Babel so any esm.sh package the widget imports resolves "react"/
 * "react-dom" to that single instance.
 *
 * Every inline `<script>` this module emits carries a per-request nonce
 * (matching the one `chartSandboxFrame.ts` puts in the response's script-src)
 * so the frame's own inline scripts still run when an edge proxy appends its
 * own `'nonce-<random>'` to script-src — a nonce present anywhere in
 * script-src makes `'unsafe-inline'` ignored per the CSP spec, so without
 * this every inline script here would be silently refused and every chart
 * widget would go blank.
 */

import { buildAuthorRuntimeScript } from "./bridge/authorRuntime";
import { buildChartsLibScript } from "./bridge/chartsLibSource";
import { buildShimScript } from "./bridge/shimSource";

/**
 * Pinned versions so a CDN release never silently changes what a saved
 * widget compiles against. Exact versions (not major-only ranges), so UNPKG
 * can never resolve a newer release out from under a saved widget.
 *
 * These majors are pinned lower than this app's own React/Recharts
 * dependency on purpose: React 19 dropped the UMD build these `<script>`
 * tags need (no `umd/` directory in the published package), so the sandbox
 * stays on the last UMD-shipping majors — react/react-dom 18, recharts 2 —
 * independent of what the app itself resolves. React 18's UMD build is the
 * one that added `ReactDOM.createRoot`, and Recharts' UMD reads
 * `window.PropTypes` as a plain global rather than requiring it — hence
 * prop-types loading first.
 *
 * Split around the `@langwatch/charts` library script: it needs
 * `window.React`/`window.Recharts` already loaded (hence after Recharts) but
 * itself needs nothing from Babel, so it lands ahead of that CDN script too —
 * still satisfying "after Recharts, before the author runtime" with room to
 * spare.
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
 * A CSP nonce is an HTML attribute value, so it must not be able to close the
 * `nonce="…"` attribute or otherwise inject markup — restrict it to the
 * base64/URL-safe alphabet nonces are actually generated from
 * (`generateChartFrameNonce` in `chartSandboxFrame.ts`).
 */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

export function assertChartFrameNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error(`invalid chart frame nonce: ${JSON.stringify(nonce)}`);
  }
}

/**
 * Builds the frame's import map from the UMD globals already loaded above, so
 * an esm.sh package that `import`s "react"/"react-dom" resolves to the SAME
 * React instance the author's own component tree renders against — a bundled
 * second copy would violate the rules of hooks the moment the two render
 * together (the same single-instance reason `chartsLib/index.ts` reads
 * `window.React` directly). Each mapped module is a `data:` module that
 * re-exports the global's own enumerable members plus a default, so both
 * `import React from "react"` and `import { useState } from "react"` work.
 *
 * Also provides "react/jsx-runtime" and "react/jsx-dev-runtime" as shimmed
 * modules that re-export the JSX runtime functions (jsx, jsxs, jsxDEV, Fragment)
 * from the UMD React global, so any esm.sh package built with the automatic
 * JSX runtime resolves to the same React instance. That module's source is
 * built once at TS build time (`buildJsxRuntimeModuleSource`) and inlined as
 * a JSON string literal below, rather than assembled inline in the generated
 * script — so it can be unit-tested on its own.
 *
 * A missing global is skipped rather than mapped, so the map never throws
 * during construction if a CDN script failed to load.
 */
export function buildJsxRuntimeModuleSource(globalName: string): string {
  return (
    `const React = window.${globalName};\n` +
    "export const Fragment = React.Fragment;\n" +
    "// React's real jsx() passes props.children through untouched. Spreading\n" +
    "// or stripping it here would change its shape: an empty or single-item\n" +
    "// array would arrive as undefined or a bare scalar instead of the array\n" +
    "// itself, breaking any component whose render does children.map(...).\n" +
    "export function jsx(type, props, key) {\n" +
    "  var p = props || {};\n" +
    "  return key === undefined ? React.createElement(type, p) : React.createElement(type, Object.assign({}, p, { key: key }));\n" +
    "}\n" +
    "export function jsxs(type, props, key) {\n" +
    "  return jsx(type, props, key);\n" +
    "}\n" +
    "export function jsxDEV(type, props, key) {\n" +
    "  return jsx(type, props, key);\n" +
    "}"
  );
}

function buildImportMapScript(): string {
  const jsxRuntimeModuleSrc = buildJsxRuntimeModuleSource("React");
  return `
(function () {
  function moduleFor(globalName) {
    var g = window[globalName];
    var names = Object.keys(g).filter(function (n) { return /^[A-Za-z_$][\\w$]*$/.test(n) && n !== "default"; });
    var src = "const m = window." + globalName + ";\\nexport default m;\\n" +
      names.map(function (n) { return "export const " + n + " = m." + n + ";"; }).join("\\n");
    return "data:text/javascript;charset=utf-8," + encodeURIComponent(src);
  }
  var jsxRuntimeModuleSrc = ${JSON.stringify(jsxRuntimeModuleSrc)};
  var globals = {
    "react": "React",
    "react-dom": "ReactDOM",
    "react-dom/client": "ReactDOM",
    "recharts": "Recharts",
    "@langwatch/charts": "LWCharts"
  };
  var imports = {};
  Object.keys(globals).forEach(function (specifier) {
    var globalName = globals[specifier];
    if (window[globalName]) {
      imports[specifier] = moduleFor(globalName);
    }
  });
  if (typeof window.React !== "undefined") {
    var jsxRuntime = "data:text/javascript;charset=utf-8," + encodeURIComponent(jsxRuntimeModuleSrc);
    imports["react/jsx-runtime"] = jsxRuntime;
    imports["react/jsx-dev-runtime"] = jsxRuntime;
  }
  var s = document.createElement("script");
  s.type = "importmap";
  // The import map is itself a script element, so CSP checks it like any
  // other inline script — it needs the nonce too, copied from the currently
  // executing script (this IIFE) rather than baked in as a literal, since
  // this whole file is a single string interpolated once per script tag.
  var cur = document.currentScript;
  if (cur && cur.nonce) {
    s.nonce = cur.nonce;
  }
  s.textContent = JSON.stringify({ imports: imports });
  document.head.appendChild(s);
})();
`;
}

export function buildChartFrameHtml(options: { nonce: string }): string {
  const { nonce } = options;
  assertChartFrameNonce(nonce);
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
    `<script nonce="${nonce}">${buildChartsLibScript()}</script>`,
    ...CDN_SCRIPTS_AFTER_CHARTS_LIB.map(
      (src) => `<script src="${src}" crossorigin></script>`,
    ),
    // After Babel, before the shim: the import map must exist before the
    // author runtime's dynamic import() runs (which is later, on lw:init).
    `<script nonce="${nonce}">${buildImportMapScript()}</script>`,
    "</head><body>",
    '<div id="lw-root"></div>',
    '<pre id="lw-compile-error"></pre>',
    `<script nonce="${nonce}">${buildShimScript()}</script>`,
    `<script nonce="${nonce}">${buildAuthorRuntimeScript()}</script>`,
    "</body></html>",
  ].join("\n");
}

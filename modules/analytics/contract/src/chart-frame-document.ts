/**
 * The sandboxed frame's document: CDN UMD tags, an import map built from those
 * globals, the shim, the author runtime — no author code, and only strings, so
 * the process that serves it calls it too.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { buildAuthorRuntimeScript } from "./chart-frame-author-runtime.ts";
import { buildChartsLibScript } from "./chart-frame-charts-lib-source.ts";
import { buildShimScript } from "./chart-frame-shim-source.ts";

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
 * The "react/jsx-runtime" the import map serves, so a package built with the
 * automatic runtime shares the frame's React. `props.children` passes through
 * untouched: spreading it would turn an empty array into undefined.
 */
export function buildJsxRuntimeModuleSource(globalName: string): string {
  return (
    `const React = window.${globalName};\n` +
    "export const Fragment = React.Fragment;\n" +
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

/**
 * The import map, from the UMD globals loaded above: each entry is a `data:`
 * module re-exporting the global, so a package importing React resolves to the
 * SAME instance. A missing global is skipped, never mapped.
 */
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
  // The import map is a script element too, so CSP checks it like any other
  // inline script: it copies the nonce off the currently executing script
  // rather than baking one in, since this source is built once.
  var cur = document.currentScript;
  if (cur && cur.nonce) {
    s.nonce = cur.nonce;
  }
  s.textContent = JSON.stringify({ imports: imports });
  document.head.appendChild(s);
})();
`;
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
    `${inline}${buildChartsLibScript()}</script>`,
    ...CDN_SCRIPTS_AFTER_CHARTS_LIB.map((src) => `<script src="${src}" crossorigin></script>`),
    // After Babel, before the shim: the import map must exist before the
    // author runtime's dynamic import() runs (which is later, on lw:init).
    `${inline}${buildImportMapScript()}</script>`,
    "</head><body>",
    '<div id="lw-root"></div>',
    '<pre id="lw-compile-error"></pre>',
    `${inline}${buildShimScript()}</script>`,
    `${inline}${buildAuthorRuntimeScript()}</script>`,
    "</body></html>",
  ].join("\n");
}

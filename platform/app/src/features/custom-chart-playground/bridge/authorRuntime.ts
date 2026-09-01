/**
 * The frame-side author runtime, as a string of plain JavaScript.
 *
 * Executes once, from the shim's `window.__lwActivateAuthor` hook — i.e. only
 * after `lw:init` has delivered params/theme, the same invariant every
 * activation path has always enforced (see `shimSource.ts`). It compiles the
 * widget's React/TSX source with Babel standalone (loaded from CDN alongside
 * the React, ReactDOM and Recharts UMD builds — see `buildSrcdoc`), resolves
 * the handful of module specifiers a widget may `import` through a tiny
 * `require` shim, and mounts the file's default export into `#lw-root`.
 *
 * A compile, load or render failure shows a readable panel in the frame
 * itself (`#lw-compile-error`) rather than a silent blank iframe, and is also
 * forwarded through `LW.error` so it reaches the parent's log panel too.
 */

export function buildAuthorRuntimeScript(): string {
  return `
(function () {
  "use strict";

  var MODULES = {
    "react": function () { return window.React; },
    "react-dom": function () { return window.ReactDOM; },
    "react-dom/client": function () { return window.ReactDOM; },
    "recharts": function () { return window.Recharts; }
  };

  function requireShim(specifier) {
    var resolve = MODULES[specifier];
    if (!resolve) {
      var available = Object.keys(MODULES).map(function (name) { return "'" + name + "'"; }).join(", ");
      throw new Error("Cannot import '" + specifier + "' — a chart widget may import only " + available + ".");
    }
    return resolve();
  }

  function showError(title, detail) {
    var panel = document.getElementById("lw-compile-error");
    if (panel) {
      panel.textContent = detail ? title + "\\n\\n" + detail : title;
      panel.style.display = "block";
    }
    if (window.LW && typeof window.LW.error === "function") {
      window.LW.error(title);
    }
  }

  window.__lwActivateAuthor = function () {
    var source = window.__LW_AUTHOR_SOURCE__;
    if (typeof source !== "string") return;

    if (!window.React || !window.ReactDOM || !window.Recharts) {
      showError(
        "Chart libraries failed to load",
        "React, ReactDOM or Recharts did not load from the CDN. Check your connection and reload."
      );
      return;
    }
    if (!window.Babel) {
      showError(
        "Compiler failed to load",
        "Babel did not load from the CDN. Check your connection and reload."
      );
      return;
    }

    var transpiled;
    try {
      transpiled = window.Babel.transform(source, {
        presets: [
          ["react", { runtime: "classic" }],
          ["typescript", { isTSX: true, allExtensions: true }]
        ],
        // preset-react/preset-typescript only strip JSX and types — import
        // and export statements are still ES module syntax until this plugin
        // rewrites them to the require()/exports.default pair \`run\` below
        // executes.
        plugins: ["transform-modules-commonjs"],
        filename: "widget.tsx"
      }).code;
    } catch (compileError) {
      showError("Compile error", compileError.message);
      return;
    }

    var moduleExports = {};
    try {
      // Babel's CJS output references \`require(...)\` and assigns to
      // \`exports.default\` — exactly the two bindings passed in here. Runs
      // in the global scope (not a closure), so an unqualified JSX-pragma
      // reference to \`React\` resolves through the window chain to the UMD
      // global, whether or not the widget also explicitly imports it.
      var run = new Function("require", "exports", transpiled);
      run(requireShim, moduleExports);
    } catch (runError) {
      showError("Widget threw while loading", runError.message);
      return;
    }

    var Component = moduleExports && moduleExports.default;
    if (typeof Component !== "function") {
      showError("No default export", "The widget file must export default a React component.");
      return;
    }

    var root = document.getElementById("lw-root");
    try {
      window.ReactDOM.createRoot(root).render(window.React.createElement(Component));
    } catch (renderError) {
      showError("Render error", renderError.message);
    }
  };
})();
`;
}

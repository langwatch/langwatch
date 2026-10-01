/**
 * The frame-side author runtime, as a string of plain JavaScript, run once
 * after `lw:init` delivered the widget source. Babel compiles it to ESM, each
 * bare specifier is rewritten, and a blob URL `import()` loads the module.
 */

import {
  CHART_FRAME_BUILTIN_MODULES,
  resolveImportSpecifier,
} from "./chart-frame-import-specifier.ts";

export function buildAuthorRuntimeScript(): string {
  return `
(function () {
  "use strict";

  // Bound to a stable name (not left as a bare declaration) so a bundler that
  // renames the source function can't desync it from the call site below.
  var resolveImportSpecifier = ${resolveImportSpecifier.toString()};
  var BUILTINS = ${JSON.stringify(CHART_FRAME_BUILTIN_MODULES)};

  function showError(title, detail) {
    var panel = document.getElementById("lw-compile-error");
    if (panel) {
      panel.textContent = detail ? title + "\\n\\n" + detail : title;
      panel.style.display = "block";
    }
    if (window.LW && typeof window.LW.error === "function") {
      // Forward the detail too, not just the title — otherwise the parent's
      // log panel gets "Compile error" with no Babel message, "Render error"
      // with no stack text, and the useful part stays trapped in the iframe.
      window.LW.error(detail ? title + ": " + detail : title);
    }
  }

  // A class error boundary: render-phase throws in author code do NOT surface
  // through the try/catch around createRoot().render() — React 18 defers the
  // render and reports the failure to the root, not the caller — so the boundary
  // is what turns a widget crash into the same readable panel a compile error
  // gets, instead of a blank frame plus a console rethrow.
  function makeErrorBoundary(React) {
    function ErrorBoundary(props) {
      React.Component.call(this, props);
      this.state = { crashed: false };
    }
    ErrorBoundary.prototype = Object.create(React.Component.prototype);
    ErrorBoundary.getDerivedStateFromError = function () {
      return { crashed: true };
    };
    ErrorBoundary.prototype.componentDidCatch = function (error) {
      showError("Widget crashed while rendering", error && error.message);
    };
    ErrorBoundary.prototype.render = function () {
      return this.state.crashed ? null : this.props.children;
    };
    return ErrorBoundary;
  }

  function mount(Component) {
    if (Component == null || (typeof Component !== "function" && typeof Component !== "object")) {
      showError("No default export", "The widget file must export default a React component.");
      return;
    }
    var root = document.getElementById("lw-root");
    try {
      var ErrorBoundary = makeErrorBoundary(window.React);
      window.ReactDOM.createRoot(root).render(
        window.React.createElement(
          ErrorBoundary,
          null,
          window.React.createElement(Component)
        )
      );
    } catch (renderError) {
      showError("Render error", renderError.message);
    }
  }

  // Rewrites the source specifier of a static import/export declaration in
  // place, so any bare package points at esm.sh (React externalised) while the
  // frame's built-ins and any URL/path are left untouched.
  function rewrite(path) {
    var src = path.node.source;
    if (src && typeof src.value === "string") {
      src.value = resolveImportSpecifier(src.value, BUILTINS);
    }
  }

  // A dynamic import() with a non-literal argument cannot be resolved
  // statically, so it is left alone and only works for a full URL.
  function rewriteDynamicImport(path) {
    var args = path.node.arguments;
    if (args && args.length > 0 && args[0].type === "StringLiteral") {
      args[0].value = resolveImportSpecifier(args[0].value, BUILTINS);
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
        // ESM out (no transform-modules-commonjs): the import/export syntax
        // stays, so the compiled module's imports resolve through the frame's
        // import map when it is loaded below.
        plugins: [{
          visitor: {
            ImportDeclaration: rewrite,
            ExportNamedDeclaration: rewrite,
            ExportAllDeclaration: rewrite,
            CallExpression: function (path) {
              if (path.node.callee.type === "Import") {
                rewriteDynamicImport(path);
              }
            }
          }
        }],
        sourceType: "module",
        filename: "widget.tsx"
      }).code;
    } catch (compileError) {
      showError("Compile error", compileError.message);
      return;
    }

    // Loading the compiled ESM by blob URL is what lets the browser resolve
    // the widget's imports (esm.sh packages, the import-mapped built-ins). The
    // classic JSX pragma's unqualified \`React\` still resolves to the UMD
    // global even inside the module, so a widget need not import React.
    var url = URL.createObjectURL(new Blob([transpiled], { type: "text/javascript" }));
    import(url).then(
      function (mod) {
        URL.revokeObjectURL(url);
        mount(mod && mod.default);
      },
      function (loadError) {
        URL.revokeObjectURL(url);
        showError("Failed to load widget or one of its imports", loadError && loadError.message);
      }
    );
  };
})();
`;
}

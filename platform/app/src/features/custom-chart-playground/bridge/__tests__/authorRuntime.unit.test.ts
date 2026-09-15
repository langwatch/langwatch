/**
 * @vitest-environment jsdom
 *
 * The author runtime compiles widget source with Babel and mounts the result.
 * This test evaluates the runtime string in a fully controlled window, driving
 * the real compilation and Babel plugin visitor — a substring check would not
 * exercise the full rewrite logic.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it, vi } from "vitest";
import { buildAuthorRuntimeScript } from "../authorRuntime";
import {
  CHART_FRAME_BUILTIN_MODULES,
  resolveImportSpecifier,
} from "../resolveImportSpecifier";

interface RuntimeWindow {
  __lwActivateAuthor?: () => void;
  __LW_AUTHOR_SOURCE__?: string;
  React?: unknown;
  ReactDOM?: unknown;
  Recharts?: unknown;
  Babel?: unknown;
  LW?: { error: (msg: string) => void };
  URL?: unknown;
  [key: string]: unknown;
}

/**
 * Evaluates the author runtime script with a controlled `window`, capturing
 * `__lwActivateAuthor` so a test can drive compilation and widget mounting.
 * Stubs are provided for globals the runtime touches at evaluation time
 * (document, URL, Blob, import).
 */
function evaluateAuthorRuntime() {
  const fakeDocument = {
    getElementById: vi.fn(() => null),
  };

  const activateAuthorCapture: { fn?: () => void } = {};
  const blobURLs: string[] = [];

  const win: RuntimeWindow = {
    document: fakeDocument,
    URL: {
      createObjectURL: (blob: unknown) => {
        const url = `blob:mock-${Math.random()}`;
        blobURLs.push(url);
        return url;
      },
      revokeObjectURL: vi.fn(),
    },
    // Stub the global Blob constructor (it's auto-available in jsdom but we control it here)
    Blob: function (parts: unknown[], options: unknown) {
      return { parts, options };
    },
  };

  // Capture __lwActivateAuthor before evaluating the runtime
  Object.defineProperty(win, "__lwActivateAuthor", {
    set(fn: () => void) {
      activateAuthorCapture.fn = fn;
    },
    get() {
      return activateAuthorCapture.fn;
    },
  });

  // Use Function constructor to evaluate the runtime with the fake window.
  // `document` and `URL` are implicit globals here (from jsdom), so override them.
  const runtimeCode = buildAuthorRuntimeScript();
  const evalFn = new Function("window", "document", "URL", "Blob", runtimeCode);
  evalFn(win, fakeDocument, win.URL, win.Blob);

  return {
    win,
    fakeDocument,
    blobURLs,
    activateAuthor: activateAuthorCapture.fn,
  };
}

describe("authorRuntime", () => {
  describe("given the Babel plugin visitor for static imports and dynamic imports", () => {
    describe("when a dynamic import() with a string literal is compiled", () => {
      /** @scenario "A widget's dynamic import of a bare package is rewritten too" */
      it("rewrites the bare specifier through resolveImportSpecifier", () => {
        const { win, activateAuthor } = evaluateAuthorRuntime();

        // Capture the plugin visitor by providing a fake Babel that extracts it
        let capturedVisitor: any = null;

        win.Babel = {
          transform: (_code: string, opts: any) => {
            const plugin = opts.plugins[0];
            // The plugin is either a function or an object with a visitor
            if (typeof plugin === "function") {
              const pluginResult = plugin();
              capturedVisitor = pluginResult.visitor;
            } else if (plugin?.visitor) {
              capturedVisitor = plugin.visitor;
            }
            // Return empty code; we're only testing the plugin, not the full compilation
            return { code: "" };
          },
        };

        win.React = {};
        win.ReactDOM = { createRoot: () => ({ render: vi.fn() }) };
        win.Recharts = {};
        win.__LW_AUTHOR_SOURCE__ = "export default () => null;";

        // Trigger compilation
        activateAuthor?.();

        // Verify the CallExpression visitor rewrites string-literal dynamic imports
        expect(capturedVisitor).toBeDefined();
        if (!capturedVisitor) {
          throw new Error("capturedVisitor is undefined");
        }
        expect(capturedVisitor.CallExpression).toBeDefined();
        if (!capturedVisitor.CallExpression) {
          throw new Error("capturedVisitor.CallExpression is undefined");
        }

        // Test 1: Dynamic import with string literal should be rewritten
        const stringLiteralImportNode = {
          node: {
            callee: { type: "Import" },
            arguments: [{ type: "StringLiteral", value: "dayjs" }],
          },
        };
        capturedVisitor.CallExpression(stringLiteralImportNode);

        const stringLiteralArg = stringLiteralImportNode.node.arguments[0];
        if (!stringLiteralArg) {
          throw new Error(
            "stringLiteralImportNode.node.arguments[0] is undefined",
          );
        }
        const expected = resolveImportSpecifier(
          "dayjs",
          CHART_FRAME_BUILTIN_MODULES,
        );
        expect(stringLiteralArg.value).toBe(expected);

        // Test 2: Dynamic import with non-literal argument should be untouched
        const nonLiteralImportNode = {
          node: {
            callee: { type: "Import" },
            arguments: [{ type: "Identifier", name: "pkgName" }],
          },
        };
        const nonLiteralArg = nonLiteralImportNode.node.arguments[0];
        if (!nonLiteralArg) {
          throw new Error(
            "nonLiteralImportNode.node.arguments[0] is undefined",
          );
        }
        const originalValue = nonLiteralArg.name;
        capturedVisitor.CallExpression(nonLiteralImportNode);
        const nonLiteralArgAfter = nonLiteralImportNode.node.arguments[0];
        if (!nonLiteralArgAfter) {
          throw new Error(
            "nonLiteralImportNode.node.arguments[0] is undefined after CallExpression",
          );
        }
        expect(nonLiteralArgAfter.name).toBe(originalValue);

        // Test 3: Built-in package should be untouched
        const builtinImportNode = {
          node: {
            callee: { type: "Import" },
            arguments: [{ type: "StringLiteral", value: "react" }],
          },
        };
        capturedVisitor.CallExpression(builtinImportNode);
        const builtinArg = builtinImportNode.node.arguments[0];
        if (!builtinArg) {
          throw new Error("builtinImportNode.node.arguments[0] is undefined");
        }
        expect(builtinArg.value).toBe("react");
      });
    });

    describe("when a widget exports a memoized or forwardRef component", () => {
      /** @scenario "A widget exporting a memoized or forwardRef component mounts" */
      it("accepts object component types (memo/forwardRef/lazy) in the mount guard", () => {
        const runtimeSource = buildAuthorRuntimeScript();

        // The mount guard should accept both functions and objects.
        // React.memo, React.forwardRef, and React.lazy return objects, not functions.
        expect(runtimeSource).toContain('typeof Component !== "object"');
        expect(runtimeSource).toContain("Component == null");

        // Verify the full check: reject only if null OR (not function AND not object)
        // This is a source-level assertion because the mount guard runs after
        // import(), which cannot be reliably stubbed from new Function().
        // End-to-end proof is the browser harness (integration tests).
        expect(runtimeSource).toContain(
          'if (Component == null || (typeof Component !== "function" && typeof Component !== "object"))',
        );
      });
    });
  });
});

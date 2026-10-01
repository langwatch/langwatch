/**
 * @vitest-environment jsdom
 * The runtime ships as a string, so this evaluates it in a controlled `window`
 * and drives the real Babel visitor it installs.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAuthorRuntimeScript } from "../chart-frame-author-runtime.ts";

interface BabelVisitor {
  ImportDeclaration: (path: { node: { source: { value: string } } }) => void;
  CallExpression: (path: {
    node: {
      callee: { type: string };
      arguments: { type: string; value: string }[];
    };
  }) => void;
}

interface RuntimeWindow {
  __lwActivateAuthor?: () => void;
  __LW_AUTHOR_SOURCE__?: string;
  [key: string]: unknown;
}

/**
 * Evaluates the runtime with a controlled `window`, capturing both the
 * activation hook it installs and the Babel plugin it hands the compiler.
 */
function evaluateAuthorRuntime() {
  const rendered: unknown[] = [];
  const panel = { textContent: "", style: { display: "none" } };
  const fakeDocument = { getElementById: () => panel };
  const captured: { visitor?: BabelVisitor } = {};
  const win: RuntimeWindow = {
    document: fakeDocument,
    React: { createElement: (type: unknown) => ({ type }), Component: function () {} },
    ReactDOM: { createRoot: () => ({ render: (node: unknown) => rendered.push(node) }) },
    Recharts: {},
    Babel: {
      transform: (_source: string, options: { plugins: { visitor: BabelVisitor }[] }) => {
        captured.visitor = options.plugins[0]?.visitor;
        return { code: "" };
      },
    },
    Blob: function Blob() {},
    URL: { createObjectURL: () => "blob:widget", revokeObjectURL: vi.fn() },
  };

  // The runtime ships as a string; evaluating it is the test.
  // oxlint-disable-next-line no-implied-eval
  const run = new Function("window", "document", "URL", "Blob", buildAuthorRuntimeScript());
  run(win, fakeDocument, win.URL, win.Blob);

  return { win, panel, rendered, captured };
}

describe("given the author runtime's Babel plugin", () => {
  describe("when a widget's static import names a bare package", () => {
    /** @scenario "A bare package import resolves to esm.sh with React externalised" */
    it("rewrites the declaration's specifier to the CDN URL", () => {
      const { win, captured } = evaluateAuthorRuntime();
      win.__LW_AUTHOR_SOURCE__ = "export default () => null;";
      win.__lwActivateAuthor?.();

      const node = { source: { value: "dayjs" } };
      captured.visitor?.ImportDeclaration({ node });

      expect(node.source.value).toBe("https://esm.sh/dayjs?external=react,react-dom");
    });
  });

  describe("when a widget calls import() with a string literal", () => {
    let runtime: ReturnType<typeof evaluateAuthorRuntime>;
    beforeEach(() => {
      runtime = evaluateAuthorRuntime();
      runtime.win.__LW_AUTHOR_SOURCE__ = "export default () => null;";
      runtime.win.__lwActivateAuthor?.();
    });

    /** @scenario "A widget's dynamic import of a bare package is rewritten too" */
    it("rewrites the literal argument and leaves a computed one alone", () => {
      const { captured } = runtime;
      const literal = {
        node: {
          callee: { type: "Import" },
          arguments: [{ type: "StringLiteral", value: "dayjs" }],
        },
      };
      const computed = {
        node: { callee: { type: "Import" }, arguments: [{ type: "Identifier", value: "name" }] },
      };
      captured.visitor?.CallExpression(literal);
      captured.visitor?.CallExpression(computed);

      expect(literal.node.arguments[0]?.value).toBe(
        "https://esm.sh/dayjs?external=react,react-dom",
      );
      expect(computed.node.arguments[0]?.value).toBe("name");
    });

    it("leaves a plain call that is not an import() alone", () => {
      const { captured } = runtime;
      const call = {
        node: {
          callee: { type: "Identifier" },
          arguments: [{ type: "StringLiteral", value: "dayjs" }],
        },
      };
      captured.visitor?.CallExpression(call);

      expect(call.node.arguments[0]?.value).toBe("dayjs");
    });
  });
});

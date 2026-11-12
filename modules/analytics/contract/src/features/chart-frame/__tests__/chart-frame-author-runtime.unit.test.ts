/**
 * @vitest-environment jsdom
 * The runtime ships as a string, so this evaluates it in a controlled `window`
 * and drives the real Babel visitor it installs.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAuthorRuntimeScript } from "../chart-frame-author-runtime.ts";
import { buildChartFrameImportMap } from "../chart-frame-import-map.ts";

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
  const root = { style: { display: "" } };
  const fakeDocument = {
    getElementById: (id: string) => (id === "lw-root" ? root : panel),
  };
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

  return { win, panel, root, rendered, captured };
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

  describe("when a widget's static import names a frame built-in", () => {
    let runtime: ReturnType<typeof evaluateAuthorRuntime>;
    beforeEach(() => {
      runtime = evaluateAuthorRuntime();
      runtime.win.__LW_AUTHOR_SOURCE__ = "export default () => null;";
      runtime.win.__lwActivateAuthor?.();
    });

    /** @scenario "A widget's own built-in import loads even where the import map was ignored" */
    it("rewrites it to the module URL the import map names for it", () => {
      const { imports } = buildChartFrameImportMap();

      for (const specifier of ["recharts", "react", "@langwatch/charts", "react/jsx-runtime"]) {
        const node = { source: { value: specifier } };
        runtime.captured.visitor?.ImportDeclaration({ node });

        expect(node.source.value).toBe(imports[specifier]);
      }
    });

    it("leaves a specifier that only looks like an object member alone", () => {
      const node = { source: { value: "./toString" } };
      runtime.captured.visitor?.ImportDeclaration({ node });

      expect(node.source.value).toBe("./toString");
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

describe("given a widget whose compiled module has a default export", () => {
  /**
   * The browser's module loader is the one boundary a vm cannot supply, so the script's
   * `import(url)` is pointed at a stand-in that resolves to the module this test chose.
   */
  async function mountDefaultExport(component: unknown) {
    const runtime = evaluateAuthorRuntime();
    runtime.win.React = {
      Component: function () {},
      createElement: (type: unknown, _props: unknown, ...children: unknown[]) => ({
        type,
        children,
      }),
    };
    runtime.win.__lwImport = () => Promise.resolve({ default: component });
    const script = buildAuthorRuntimeScript().replace("import(url)", "window.__lwImport(url)");
    // The runtime ships as a string; evaluating it is the test.
    // oxlint-disable-next-line no-implied-eval
    const run = new Function("window", "document", "URL", "Blob", script);
    run(runtime.win, runtime.win.document, runtime.win.URL, runtime.win.Blob);
    runtime.win.__LW_AUTHOR_SOURCE__ = "export default Widget;";
    (runtime.win.__lwActivateAuthor as () => void)();
    await vi.waitFor(() => {
      expect(runtime.rendered.length + (runtime.panel.textContent ? 1 : 0)).toBeGreaterThan(0);
    });
    return runtime;
  }

  describe("when the default export is a memoized or forwardRef component", () => {
    // React.memo and React.forwardRef return objects tagged with these symbols, not functions.
    const widgets = {
      "React.memo": () => ({ $$typeof: Symbol.for("react.memo"), type: () => null }),
      "React.forwardRef": () => ({ $$typeof: Symbol.for("react.forward_ref"), render: () => null }),
    };

    for (const [name, make] of Object.entries(widgets)) {
      /** @scenario "A widget exporting a memoized or forwardRef component mounts" */
      it(`mounts a ${name} component and shows no error panel`, async () => {
        const component = make();
        const { rendered, panel } = await mountDefaultExport(component);

        expect(rendered).toHaveLength(1);
        const boundary = rendered[0] as { children: { type: unknown }[] };
        expect(boundary.children[0]?.type).toBe(component);
        expect(panel.textContent).not.toContain("No default export");
        expect(panel.style.display).toBe("none");
      });
    }
  });

  describe("when the widget mounts", () => {
    /** @scenario "A widget whose code is still loading keeps its skeleton" */
    it("tells the shim its code has mounted once the widget's own effects ran", async () => {
      const { rendered, win } = await mountDefaultExport(() => null);
      const mounted = vi.fn();
      win.__lwAuthorMounted = mounted;
      const effects: (() => void)[] = [];
      (win.React as Record<string, unknown>).useEffect = (effect: () => void) =>
        effects.push(effect);

      const boundary = rendered[0] as { children: { type: () => unknown }[] };
      boundary.children[1]?.type();
      expect(mounted).not.toHaveBeenCalled();
      for (const effect of effects) effect();

      expect(mounted).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the module has no default export at all", () => {
    it("shows the No default export panel and mounts nothing", async () => {
      const { rendered, panel } = await mountDefaultExport(undefined);

      expect(rendered).toHaveLength(0);
      expect(panel.textContent).toContain("No default export");
    });
  });
});

describe("given a widget that imports an http module URL", () => {
  /** @scenario "An http module URL is rejected with a clear compile error" */
  it("shows the Compile error panel with the https message, even when the import is unused", () => {
    const runtime = evaluateAuthorRuntime();
    interface ProgramVisitor {
      Program: { enter: (path: { node: { body: { source?: { value: string } }[] } }) => void };
    }
    // Stand-in for the real compiler: Babel visits Program before anything else
    // and propagates a throw from the plugin, as the real one does.
    runtime.win.Babel = {
      transform: (_source: string, options: { plugins: { visitor: ProgramVisitor }[] }) => {
        options.plugins[0]?.visitor.Program.enter({
          node: { body: [{ source: { value: "http://example.com/lib.js" } }, {}] },
        });
        return { code: "" };
      },
    };
    runtime.win.__LW_AUTHOR_SOURCE__ = 'import x from "http://example.com/lib.js";';
    (runtime.win.__lwActivateAuthor as () => void)();

    expect(runtime.panel.style.display).toBe("block");
    expect(runtime.panel.textContent).toContain("Compile error");
    expect(runtime.panel.textContent).toContain("Module URLs must use https:");
    expect(runtime.root.style.display).toBe("none");
  });
});

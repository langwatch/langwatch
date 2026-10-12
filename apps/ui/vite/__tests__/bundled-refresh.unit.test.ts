import { readFile } from "fs/promises";
// @vitest-environment node
import { createRequire } from "module";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import vm from "vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_REFRESH_PREAMBLE, bundledRefresh } from "../bundled-refresh";

type RefreshRuntime = {
  injectIntoGlobalHook: (page: object) => void;
  register: (type: unknown, id: string) => void;
  registerExportsForReactRefresh: (file: string, exports: object) => void;
  validateRefreshBoundaryAndEnqueueUpdate: (
    file: string,
    previous: object,
    next: object,
  ) => string | undefined;
};

type Renderer = { scheduleRefresh: () => void; setRefreshHandler: () => void };

function pageWithPreamble() {
  const page: Record<string, unknown> = {};
  page.window = page;
  vm.runInNewContext(BUNDLED_REFRESH_PREAMBLE, page);
  return page;
}

// plugin-react serves this file as /@react-refresh; read it from the package, as it does.
async function loadRefreshRuntime({ page }: { page: Record<string, unknown> }) {
  const entry = createRequire(import.meta.url).resolve("@vitejs/plugin-react");
  const source = await readFile(path.join(path.dirname(entry), "refresh-runtime.js"), "utf-8");
  Object.assign(globalThis, { window: page });
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return (await import(/* @vite-ignore */ url)) as RefreshRuntime;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("bundled dev Fast Refresh preamble", () => {
  describe("when it runs before react-dom", () => {
    it("defines the registration stubs the bundled modules check for", () => {
      const page = pageWithPreamble();

      expect(typeof page.$RefreshReg$).toBe("function");
      expect(typeof (page.$RefreshSig$ as () => unknown)()).toBe("function");
    });

    it("records each renderer React injects, so the runtime can adopt it later", () => {
      const page = pageWithPreamble();
      const hook = page.__REACT_DEVTOOLS_GLOBAL_HOOK__ as {
        inject: (renderer: Renderer) => number;
        renderers: Map<number, Renderer>;
      };
      const renderer: Renderer = { scheduleRefresh: vi.fn(), setRefreshHandler: vi.fn() };

      const id = hook.inject(renderer);

      expect(hook.renderers.get(id)).toBe(renderer);
    });
  });

  describe("when the refresh runtime is injected after react-dom has already run", () => {
    it("refreshes an edited component through the renderer React injected earlier", async () => {
      const page = pageWithPreamble();
      const hook = page.__REACT_DEVTOOLS_GLOBAL_HOOK__ as {
        inject: (renderer: Renderer) => number;
      };
      const renderer: Renderer = { scheduleRefresh: vi.fn(), setRefreshHandler: vi.fn() };
      hook.inject(renderer);
      const runtime = await loadRefreshRuntime({ page });
      runtime.injectIntoGlobalHook(page);
      const before = function Card() {};
      const after = function Card() {};
      runtime.register(before, "card.tsx Card");
      runtime.registerExportsForReactRefresh("card.tsx", { Card: before });
      runtime.register(after, "card.tsx Card");

      const invalidated = runtime.validateRefreshBoundaryAndEnqueueUpdate(
        "card.tsx",
        { Card: before },
        { Card: after },
      );
      await delay(60);

      expect(invalidated).toBeUndefined();
      expect(renderer.setRefreshHandler).toHaveBeenCalled();
    });
  });

  describe("when react-dom runs before any hook exists (the old stub)", () => {
    it("leaves the runtime with no renderer to refresh", async () => {
      const page: Record<string, unknown> = {};
      page.window = page;
      const runtime = await loadRefreshRuntime({ page });

      runtime.injectIntoGlobalHook(page);

      const hook = page.__REACT_DEVTOOLS_GLOBAL_HOOK__ as { renderers: Map<number, Renderer> };
      expect(hook.renderers.size).toBe(0);
    });
  });

  describe("when Vite builds the index page", () => {
    it("prepends the preamble to the head, serve only", () => {
      const plugin = bundledRefresh();
      const transform = plugin.transformIndexHtml as () => unknown;

      expect(plugin.apply).toBe("serve");
      expect(transform()).toEqual([
        { tag: "script", children: BUNDLED_REFRESH_PREAMBLE, injectTo: "head-prepend" },
      ]);
    });
  });
});

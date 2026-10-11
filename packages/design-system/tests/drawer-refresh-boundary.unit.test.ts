// @vitest-environment node
import { readFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RefreshRuntime = {
  injectIntoGlobalHook: (page: object) => void;
  registerExportsForReactRefresh: (file: string, exports: object) => void;
  validateRefreshBoundaryAndEnqueueUpdate: (
    file: string,
    previous: object,
    next: object,
  ) => string | undefined;
};

type ModuleExports = Record<string, unknown>;

// plugin-react serves this file as /@react-refresh; vitest-config is the package declaring it.
async function loadRefreshRuntime() {
  const fromHere = createRequire(import.meta.url);
  const fromConfig = createRequire(fromHere.resolve("@langwatch/vitest-config"));
  const entry = fromConfig.resolve("@vitejs/plugin-react");
  const source = await readFile(path.join(path.dirname(entry), "refresh-runtime.js"), "utf-8");
  const page: Record<string, unknown> = {};
  page.window = page;
  Object.assign(globalThis, { window: page });
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const runtime = (await import(/* @vite-ignore */ url)) as RefreshRuntime;
  runtime.injectIntoGlobalHook(page);
  return runtime;
}

async function evaluateTwice({ load }: { load: () => Promise<ModuleExports> }) {
  vi.resetModules();
  const previous = await load();
  vi.resetModules();
  const next = await load();
  return { previous: { ...previous }, next: { ...next } };
}

describe("overlay Fast Refresh boundaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "window");
  });

  describe("when the drawer implementation module is edited and evaluated again", () => {
    it("is a boundary the real refresh runtime accepts without invalidating", async () => {
      const runtime = await loadRefreshRuntime();
      const { previous, next } = await evaluateTwice({
        load: () => import("../src/components/overlays/views/drawer-view.tsx"),
      });
      runtime.registerExportsForReactRefresh("drawer-view.tsx", previous);

      const invalidated = runtime.validateRefreshBoundaryAndEnqueueUpdate(
        "drawer-view.tsx",
        previous,
        next,
      );

      expect(invalidated).toBeUndefined();
    });
  });

  describe("when the dialog implementation module is edited and evaluated again", () => {
    it("is a boundary the real refresh runtime accepts without invalidating", async () => {
      const runtime = await loadRefreshRuntime();
      const { previous, next } = await evaluateTwice({
        load: () => import("../src/components/overlays/views/dialog-view.tsx"),
      });
      runtime.registerExportsForReactRefresh("dialog-view.tsx", previous);

      const invalidated = runtime.validateRefreshBoundaryAndEnqueueUpdate(
        "dialog-view.tsx",
        previous,
        next,
      );

      expect(invalidated).toBeUndefined();
    });
  });

  describe("when a module that holds a provider and a store is evaluated again", () => {
    it("is not a boundary, which is why those live outside the implementation modules", async () => {
      const runtime = await loadRefreshRuntime();
      const { previous, next } = await evaluateTwice({
        load: () => import("../src/overlays/drawer-inset.ts"),
      });

      const invalidated = runtime.validateRefreshBoundaryAndEnqueueUpdate(
        "drawer-inset.ts",
        previous,
        next,
      );

      expect(invalidated).toContain("export is incompatible");
    });
  });
});

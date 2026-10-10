/**
 * The groups read Rolldown's module graph at build time; these pin how they walk it.
 * Spec: specs/ui/boot-recovery.feature
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import {
  type CoreModuleInfo,
  entryCoreChunkGroup,
  entryStaticClosure,
  HOST_MOUNT_MODULE,
} from "../entry-core-chunks";

type Edges = { imports?: string[]; dynamic?: string[]; isEntry?: boolean };

/** A module graph from each module's static and dynamic imports. */
function graph(modules: Record<string, Edges>) {
  const info = (id: string): CoreModuleInfo | null => {
    const own = modules[id];
    if (own === undefined) return null;
    const importersBy = (kind: "imports" | "dynamic") =>
      Object.keys(modules).filter((other) => modules[other]?.[kind]?.includes(id));
    return {
      isEntry: own.isEntry === true,
      importedIds: own.imports ?? [],
      importers: importersBy("imports"),
      dynamicImporters: importersBy("dynamic"),
    };
  };
  return { getModuleInfo: info };
}

const APP = {
  "index.html": { isEntry: true, imports: ["/src/main.tsx"] },
  "/src/main.tsx": {
    imports: ["/node_modules/react-dom/client.js", "/packages/browser/src/ui.ts"],
    dynamic: ["/modules/trace/src/traces-screen.tsx"],
  },
  "/packages/browser/src/ui.ts": {},
  "/node_modules/react-dom/client.js": {},
  "/modules/trace/src/traces-screen.tsx": { imports: ["/node_modules/shiki/index.js"] },
  "/node_modules/shiki/index.js": {},
};

describe("given the entry and a screen it loads lazily", () => {
  describe("when the closure is found from a module deep in the screen", () => {
    it("holds what the entry imports statically, and not the screen", () => {
      const closure = entryStaticClosure({
        anyModule: "/node_modules/shiki/index.js",
        ctx: graph(APP),
      });

      expect([...closure].toSorted()).toEqual([
        "/node_modules/react-dom/client.js",
        "/packages/browser/src/ui.ts",
        "/src/main.tsx",
      ]);
    });
  });

  describe("when the core group names each module", () => {
    /** @scenario "The entry's static imports share one core file" */
    it("puts our code in core, third-party code in core-vendor, and leaves the screen", () => {
      const { name } = entryCoreChunkGroup({ priority: 1 });
      const ctx = graph(APP);

      expect(name("/src/main.tsx", ctx)).toBe("core");
      expect(name("/packages/browser/src/ui.ts", ctx)).toBe("core");
      expect(name("/node_modules/react-dom/client.js", ctx)).toBe("core-vendor");
      expect(name("/modules/trace/src/traces-screen.tsx", ctx)).toBeNull();
      expect(name("/node_modules/shiki/index.js", ctx)).toBeNull();
      expect(name("index.html", ctx)).toBeNull();
    });
  });
});

describe("given a module's host mount", () => {
  /** @scenario "The host mounts share one file" */
  it("is matched by the host-mounts group, and its host model is not", () => {
    expect(HOST_MOUNT_MODULE.test("/modules/authz/browser/src/behavior/authz-host-mount.tsx")).toBe(
      true,
    );
    expect(HOST_MOUNT_MODULE.test("/modules/authz/browser/src/model/authz-host.ts")).toBe(false);
  });
});

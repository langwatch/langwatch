import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isolateInVmContexts, VM_MEMORY_LIMIT } from "../isolate-in-vm-contexts.ts";
import { defineModuleVitestConfig } from "../vitest-config.ts";

const MOCKING = 'import { vi } from "vitest";\nvi.mock("../store.ts");\n';
const PLAIN = 'import { it } from "vitest";\nit("works", () => {});\n';
const NODE_PRAGMA = "/**\n * @vitest-environment node\n */\n" + PLAIN;

describe("isolateInVmContexts", () => {
  let root: string;

  const write = (files: Record<string, string>) => {
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), body);
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vm-contexts-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe("given a suite that isolates every file", () => {
    /** @scenario "Isolated files share a worker and get a fresh window each" */
    it("runs the whole suite on vmForks with a memory limit", () => {
      write({ "src/a.test.ts": PLAIN, "src/b.test.tsx": PLAIN });

      const test = isolateInVmContexts({ test: { isolate: true }, root });

      expect(test).toEqual({ isolate: true, pool: "vmForks", vmMemoryLimit: VM_MEMORY_LIMIT });
    });

    /** @scenario "A file that cannot run in a vm context keeps a process of its own" */
    it("gives the named files and the node-environment files a process each", () => {
      write({
        "src/a.test.ts": PLAIN,
        "src/location.test.tsx": PLAIN,
        "vite/node.test.ts": NODE_PRAGMA,
      });

      const test = isolateInVmContexts({
        test: { isolate: true, exclude: ["**/node_modules/**"] },
        root,
        needsOwnProcess: ["src/location.test.tsx"],
      });

      expect(test.projects).toEqual([
        {
          extends: true,
          test: {
            name: "isolated",
            pool: "vmForks",
            sequence: { groupOrder: 1 },
            include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
            exclude: ["**/node_modules/**", "src/location.test.tsx", "vite/node.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "own-process",
            isolate: true,
            sequence: { groupOrder: 2 },
            include: ["src/location.test.tsx", "vite/node.test.ts"],
          },
        },
      ]);
      expect("include" in test).toBe(false);
      expect(test.vmMemoryLimit).toBe(VM_MEMORY_LIMIT);
    });
  });

  describe("given a suite already split by mocking", () => {
    const split = (include: string[]) => ({
      projects: [
        { extends: true as const, test: { name: "shared-modules", isolate: false } },
        { extends: true as const, test: { name: "isolated", isolate: true, include } },
      ],
    });

    /** @scenario "Isolated files share a worker and get a fresh window each" */
    it("moves only the isolated project onto vmForks, limiting memory at the root", () => {
      write({ "src/a.test.ts": MOCKING, "src/b.test.ts": PLAIN });

      const test = isolateInVmContexts({ test: split(["src/a.test.ts"]), root });

      // vitest reads the limit from the root config, never from a project.
      expect(test.vmMemoryLimit).toBe(VM_MEMORY_LIMIT);

      expect(test.projects).toEqual([
        { extends: true, test: { name: "shared-modules", isolate: false } },
        {
          extends: true,
          test: {
            name: "isolated",
            isolate: true,
            pool: "vmForks",
            sequence: { groupOrder: 1 },
            include: ["src/a.test.ts"],
          },
        },
      ]);
    });

    /** @scenario "A file that cannot run in a vm context keeps a process of its own" */
    it("splits a named file out of the isolated project, reading escaped names", () => {
      write({ "src/[id]/a.test.ts": MOCKING, "src/c.test.ts": MOCKING });

      const test = isolateInVmContexts({
        test: split(["src/\\[id\\]/a.test.ts", "src/c.test.ts"]),
        root,
        needsOwnProcess: ["src/*/a.test.ts"],
      });

      expect(test.projects?.slice(1)).toEqual([
        expect.objectContaining({
          test: expect.objectContaining({ pool: "vmForks", include: ["src/c.test.ts"] }),
        }),
        {
          extends: true,
          test: {
            name: "own-process",
            isolate: true,
            sequence: { groupOrder: 2 },
            include: ["src/\\[id\\]/a.test.ts"],
          },
        },
      ]);
    });

    /** @scenario "A file that cannot run in a vm context keeps a process of its own" */
    it("keeps the isolated project on processes when every file in it needs one", () => {
      write({ "src/a.test.ts": NODE_PRAGMA + MOCKING });

      const test = isolateInVmContexts({ test: split(["src/a.test.ts"]), root });

      expect(test.projects?.[1]).toEqual({
        extends: true,
        test: {
          name: "isolated",
          isolate: true,
          sequence: { groupOrder: 2 },
          include: ["src/a.test.ts"],
        },
      });
    });
  });

  describe("given a suite that keeps isolation off", () => {
    /** @scenario "A suite that does not ask for vm contexts keeps a process per isolated file" */
    it("returns the options untouched", () => {
      const test = { isolate: false };

      expect(isolateInVmContexts({ test, root })).toBe(test);
    });
  });

  describe("given a suite built with defineModuleVitestConfig", () => {
    /** @scenario "A suite that does not ask for vm contexts keeps a process per isolated file" */
    it("leaves the isolated files on forks unless the suite asks for vm contexts", () => {
      write({ "src/a.test.ts": PLAIN });

      const { test } = defineModuleVitestConfig({ kind: "jsdom", isolate: "all", root });

      expect(test?.pool).toBe("forks");
      expect(test?.isolate).toBe(true);
    });

    /** @scenario "Isolated files share a worker and get a fresh window each" */
    it("puts a split suite's isolated files on vmForks when asked", () => {
      write({ "src/a.test.ts": MOCKING, "src/b.test.ts": PLAIN });

      const { test } = defineModuleVitestConfig({
        kind: "jsdom",
        isolate: true,
        isolateIn: "vm-context",
        root,
      });

      expect(test?.projects?.[0]).toMatchObject({ test: { name: "shared-modules" } });
      expect(test?.projects?.[1]).toMatchObject({
        test: { name: "isolated", pool: "vmForks", include: ["src/a.test.ts"] },
      });
    });

    /** @scenario "Turning fast mode off keeps a process per isolated file" */
    it("keeps a process per file when fast mode is off", () => {
      vi.stubEnv("LANGWATCH_VITEST_FAST", "0");
      write({ "src/a.test.ts": PLAIN });

      const { test } = defineModuleVitestConfig({
        kind: "jsdom",
        isolate: "all",
        isolateIn: "vm-context",
        root,
      });

      expect(test?.pool).toBe("forks");
      expect(test?.projects).toBeUndefined();
    });
  });
});

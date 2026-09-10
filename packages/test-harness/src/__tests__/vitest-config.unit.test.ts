import { describe, expect, it } from "vitest";

import {
  defineModuleVitestConfig,
  moduleVitestTestOptions,
} from "../vitest-config.ts";

describe("moduleVitestTestOptions", () => {
  describe("given the node kind", () => {
    it("runs without isolation on a forks pool", () => {
      const test = moduleVitestTestOptions({ kind: "node" });

      expect(test?.environment).toBe("node");
      expect(test?.isolate).toBe(false);
      expect(test?.pool).toBe("forks");
    });

    it("turns on the on-disk transform cache", () => {
      expect(moduleVitestTestOptions({ kind: "node" })?.fsModuleCache).toBe(true);
    });

    it("keeps files running in parallel and never watches", () => {
      const test = moduleVitestTestOptions({ kind: "node" });

      expect(test?.fileParallelism).toBe(true);
      expect(test?.watch).toBe(false);
    });

    it("prints the import breakdown only when a threshold warns", () => {
      expect(moduleVitestTestOptions({ kind: "node" })?.experimental).toEqual({
        importDurations: { print: "on-warn" },
      });
    });

    it("excludes node_modules and dist by default", () => {
      expect(moduleVitestTestOptions({ kind: "node" })?.exclude).toEqual([
        "**/node_modules/**",
        "**/dist/**",
      ]);
    });

    it("omits include, setupFiles, testTimeout and dir when unasked", () => {
      const test = moduleVitestTestOptions({ kind: "node" }) ?? {};

      expect("include" in test).toBe(false);
      expect("setupFiles" in test).toBe(false);
      expect("testTimeout" in test).toBe(false);
      expect("dir" in test).toBe(false);
    });
  });

  describe("given the jsdom kind", () => {
    it("keeps isolation on so hoisted module mocks stay per file", () => {
      const test = moduleVitestTestOptions({ kind: "jsdom" });

      expect(test?.environment).toBe("jsdom");
      expect(test?.isolate).toBe(true);
    });
  });

  describe("when the caller overrides the defaults", () => {
    it("honours an explicit isolate over the kind's default", () => {
      expect(moduleVitestTestOptions({ kind: "node", isolate: true })?.isolate).toBe(
        true,
      );
      expect(
        moduleVitestTestOptions({ kind: "jsdom", isolate: false })?.isolate,
      ).toBe(false);
    });

    it("carries include, exclude, setupFiles, testTimeout and dir through", () => {
      const test = moduleVitestTestOptions({
        kind: "node",
        include: ["tests/**/*.test.ts"],
        exclude: ["**/fixtures/**"],
        setupFiles: ["./vitest.setup.ts"],
        testTimeout: 30_000,
        dir: "src",
      });

      expect(test?.include).toEqual(["tests/**/*.test.ts"]);
      expect(test?.exclude).toEqual(["**/fixtures/**"]);
      expect(test?.setupFiles).toEqual(["./vitest.setup.ts"]);
      expect(test?.testTimeout).toBe(30_000);
      expect(test?.dir).toBe("src");
    });

    it("merges an escape-hatch test block over everything else", () => {
      const test = moduleVitestTestOptions({
        kind: "node",
        test: { pool: "threads", globals: true },
      });

      expect(test?.pool).toBe("threads");
      expect(test?.globals).toBe(true);
      expect(test?.fsModuleCache).toBe(true);
    });
  });
});

describe("defineModuleVitestConfig", () => {
  it("wraps the options in a vitest config object", () => {
    expect(defineModuleVitestConfig({ kind: "node" })).toEqual({
      test: moduleVitestTestOptions({ kind: "node" }),
    });
  });
});

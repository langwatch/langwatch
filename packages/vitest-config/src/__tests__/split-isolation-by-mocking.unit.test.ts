import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { splitIsolationByMocking } from "../split-isolation-by-mocking.ts";
import { defineModuleVitestConfig } from "../vitest-config.ts";

const MOCKING = 'import { vi } from "vitest";\nvi.mock("../store.ts");\n';
const PLAIN = 'import { it } from "vitest";\nit("works", () => {});\n';

describe("splitIsolationByMocking", () => {
  let root: string;

  const write = (files: Record<string, string>) => {
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), body);
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "split-isolation-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("given a suite that keeps isolation off", () => {
    /** @scenario "A suite that keeps isolation off is left as it is" */
    it("returns the options untouched", () => {
      write({ "src/a.test.ts": MOCKING, "src/b.test.ts": PLAIN });
      const test = { isolate: false };

      expect(splitIsolationByMocking({ test, root })).toBe(test);
    });
  });

  describe("given an isolated suite where only some files mock", () => {
    /** @scenario "Files that mock modules run isolated and the rest share modules" */
    it("isolates the mocking files and shares modules across the rest", () => {
      write({
        "src/a.test.ts": MOCKING,
        "src/b.test.tsx": PLAIN,
        "src/c.test.ts": 'vi.doMock("./x.ts", () => ({}));\n',
      });

      const split = splitIsolationByMocking({
        test: { isolate: true, exclude: ["**/node_modules/**"] },
        root,
      });

      expect(split.projects).toEqual([
        {
          extends: true,
          test: {
            name: "shared-modules",
            isolate: false,
            include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
            exclude: ["**/node_modules/**", "src/a.test.ts", "src/c.test.ts"],
          },
        },
        {
          extends: true,
          test: { name: "isolated", isolate: true, include: ["src/a.test.ts", "src/c.test.ts"] },
        },
      ]);
    });

    /** @scenario "A file that imports a helper which mocks modules runs isolated" */
    it("isolates a file whose relative import mocks, however deep", () => {
      write({
        "src/a.test.ts": 'import { harness } from "./harness";\n',
        "src/harness.tsx": 'export { rows } from "./fixtures/rows.ts";\n',
        "src/fixtures/rows.ts": MOCKING,
        "src/b.test.ts": 'import { thing } from "@langwatch/other";\n' + PLAIN,
      });

      const split = splitIsolationByMocking({ test: { isolate: true }, root });

      expect(split.projects?.[1]).toMatchObject({ test: { include: ["src/a.test.ts"] } });
    });

    /** @scenario "A file the suite names as leaking runs isolated without mocking" */
    it("isolates a file alsoIsolate names, or one importing a file it names", () => {
      write({
        "src/a.test.ts": MOCKING,
        "src/named.test.tsx": PLAIN,
        "src/story.test.tsx": 'import preview from "../.storybook/preview.tsx";\n',
        ".storybook/preview.tsx": "export default {};\n",
        "src/b.test.ts": PLAIN,
      });

      const split = splitIsolationByMocking({
        test: { isolate: true },
        root,
        alsoIsolate: ["src/named.test.tsx", ".storybook/**"],
      });

      expect(split.projects?.[1]).toMatchObject({
        test: { include: ["src/a.test.ts", "src/named.test.tsx", "src/story.test.tsx"] },
      });
    });

    /** @scenario "Only the files the suite selects are considered" */
    it("only considers the files the suite's include and exclude select", () => {
      write({
        "src/a.integration.test.ts": MOCKING,
        "src/b.test.ts": MOCKING,
        "src/c.test.ts": PLAIN,
      });

      const split = splitIsolationByMocking({
        test: {
          isolate: true,
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
        },
        root,
      });

      expect(split.projects?.[1]).toMatchObject({ test: { include: ["src/b.test.ts"] } });
    });

    /** @scenario "The isolated project collects only the files that need isolation" */
    it("keeps the suite's include off the root, so projects do not inherit it", () => {
      write({ "src/b.test.ts": MOCKING, "src/c.test.ts": PLAIN });

      const split = splitIsolationByMocking({
        test: { isolate: true, include: ["src/**/*.test.ts"] },
        root,
      });

      expect("include" in split).toBe(false);
      expect(split.projects?.[0]).toMatchObject({ test: { include: ["src/**/*.test.ts"] } });
      expect(split.projects?.[1]).toMatchObject({ test: { include: ["src/b.test.ts"] } });
    });

    /** @scenario "A file that imports a helper which mocks modules runs isolated" */
    it("follows a .js specifier to the TypeScript file it means", () => {
      write({
        "src/a.test.ts": 'import { harness } from "./harness.js";\n',
        "src/harness.ts": MOCKING,
        "src/b.test.ts": PLAIN,
      });

      const split = splitIsolationByMocking({ test: { isolate: true }, root });

      expect(split.projects?.[1]).toMatchObject({ test: { include: ["src/a.test.ts"] } });
    });

    /** @scenario "A file that imports a helper which mocks modules runs isolated" */
    it("isolates every file reaching a mock through an import cycle", () => {
      write({
        "src/a.test.ts": 'import "./cycle-a.ts";\n',
        "src/b.test.ts": 'import "./cycle-b.ts";\n',
        "src/cycle-a.ts": 'import "./cycle-b.ts";\nimport "./harness.ts";\n',
        "src/cycle-b.ts": 'import "./cycle-a.ts";\n',
        "src/harness.ts": MOCKING,
        "src/c.test.ts": PLAIN,
      });

      const split = splitIsolationByMocking({ test: { isolate: true }, root });

      expect(split.projects?.[1]).toMatchObject({
        test: { include: ["src/a.test.ts", "src/b.test.ts"] },
      });
    });

    /** @scenario "A file name with glob characters is matched literally" */
    it("escapes glob characters in file names", () => {
      write({ "src/[id]/a.test.ts": MOCKING, "src/b.test.ts": PLAIN });

      const split = splitIsolationByMocking({ test: { isolate: true }, root });

      expect(split.projects?.[1]).toMatchObject({ test: { include: ["src/\\[id\\]/a.test.ts"] } });
    });

    /** @scenario "A file name with glob characters is matched literally" */
    it("escapes a backslash in a file name", () => {
      write({ "src/a\\b.test.ts": MOCKING, "src/b.test.ts": PLAIN });

      const split = splitIsolationByMocking({ test: { isolate: true }, root });

      expect(split.projects?.[1]).toMatchObject({ test: { include: ["src/a\\\\b.test.ts"] } });
    });
  });

  describe("when every file mocks, or none does", () => {
    /** @scenario "A suite where every file mocks, or none does, is left as it is" */
    it("returns the options untouched", () => {
      write({ "src/a.test.ts": MOCKING });
      const allMock = { isolate: true };
      expect(splitIsolationByMocking({ test: allMock, root })).toBe(allMock);

      rmSync(join(root, "src"), { recursive: true });
      write({ "src/b.test.ts": PLAIN });
      const noneMock = { isolate: true };
      expect(splitIsolationByMocking({ test: noneMock, root })).toBe(noneMock);
    });
  });

  describe("given a suite that asks for whole-suite isolation", () => {
    /** @scenario "A suite that isolates every file is left whole" */
    it("isolates every file and builds no projects", () => {
      const { test } = defineModuleVitestConfig({ kind: "node", isolate: "all" });

      expect(test?.isolate).toBe(true);
      expect(test?.projects).toBeUndefined();
    });
  });
});

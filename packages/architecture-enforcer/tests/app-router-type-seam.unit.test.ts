/**
 * @vitest-environment node
 * @see dev/docs/adr/130-the-api-router-type-is-declared.md
 * A ratchet on how many workspace files the compiler loads to type every module's procedures.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkFiles } from "../src/workspace/layout.ts";
import { createWorkspaceModuleResolver, moduleImports } from "../src/workspace/module-graph.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Measured at 1,595 when the aggregated `AppRouter` gave way to per-module maps
 * derived from each contract. A ceiling, not a target. Lower it when earned;
 * never raise it without saying why.
 */
const CEILING = 1_700;

/** Every browser file that declares a module's typed procedures through `createModuleApi`. */
function moduleApiDeclarations(): string[] {
  const moduleDirs = ["modules", join("enterprise", "modules")].flatMap((parent) =>
    readdirSync(join(REPO_ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPO_ROOT, parent, entry.name, "browser", "src")),
  );
  return moduleDirs
    .flatMap((dir) => walkFiles(dir, (path) => /\.tsx?$/.test(path) && !path.includes("__tests__")))
    .filter((file) => readFileSync(file, "utf8").includes("createModuleApi<"));
}

/**
 * The walk scans every workspace manifest and then thousands of files, so both
 * tests share one result. Building it twice doubles a slow test for nothing.
 */
let walked: ReadonlySet<string> | undefined;

function moduleApiGraph(): ReadonlySet<string> {
  walked ??= reachableWorkspaceModules({ roots: moduleApiDeclarations() });
  return walked;
}

/** Everything the compiler loads to answer what the types at `roots` are. */
function reachableWorkspaceModules({ roots }: { roots: readonly string[] }): ReadonlySet<string> {
  const resolver = createWorkspaceModuleResolver({ root: REPO_ROOT });
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const entry of moduleImports({ file })) {
      if (entry.nonLiteral) continue;
      const target = resolver.resolve({ specifier: entry.specifier, file });
      if (target === undefined || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

describe("given a program names every module's typed procedures", () => {
  describe("when the modules it loads are counted", () => {
    /** @scenario "The module procedure maps' graph stays under its ceiling" */
    it("stays under the recorded ceiling", { timeout: 120_000 }, () => {
      const roots = moduleApiDeclarations();
      expect(roots.length).toBeGreaterThan(30);
      const reached = moduleApiGraph();

      expect(
        reached.size,
        `Typing every module's procedures now loads ${reached.size} workspace source files ` +
          `(ceiling ${CEILING}). Something added a module to a procedure map's graph. See ADR-130.`,
      ).toBeLessThan(CEILING);
    });
  });

  describe("when a module's procedure map is reached", () => {
    /** @scenario "A module's procedure map is reached without its process half" */
    it("does not reach a process package or an application", { timeout: 120_000 }, () => {
      const processHalf = /^(enterprise\/)?modules\/[^/]+\/process\//;
      const leaked = [...moduleApiGraph()]
        .map((file) =>
          file
            .slice(REPO_ROOT.length + 1)
            .split(sep)
            .join("/"),
        )
        .filter((file) => processHalf.test(file) || file.startsWith("apps/"));

      expect(existsSync(join(REPO_ROOT, "modules", "trace", "process", "src"))).toBe(true);
      expect(leaked.toSorted()).toEqual([]);
    });
  });
});

describe("given the browser application is compiled", () => {
  describe("when the modules its own program loads are walked", () => {
    /** @scenario "The browser program compiles no API application source" */
    it("loads no file out of the API application", { timeout: 240_000 }, () => {
      const uiSource = join(REPO_ROOT, "apps", "ui", "src");
      const reached = reachableWorkspaceModules({
        roots: walkFiles(uiSource, (path) => /\.tsx?$/.test(path)),
      });

      const apiFiles = [...reached].filter((file) =>
        file.startsWith(join(REPO_ROOT, "apps", "api", "src") + sep),
      );

      expect(
        apiFiles.map((file) => file.slice(REPO_ROOT.length + 1)).toSorted(),
        "The browser application reached the API application's source. Its typecheck now " +
          "compiles the API process. See ADR-130.",
      ).toEqual([]);
    });
  });
});

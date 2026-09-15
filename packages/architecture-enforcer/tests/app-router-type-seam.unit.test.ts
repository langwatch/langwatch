/**
 * @vitest-environment node
 *
 * @see specs/setup/app-router-type-seam.feature
 * @see dev/docs/adr/130-the-api-router-type-is-declared.md
 *
 * A ratchet on one number: how many workspace source files the compiler has to
 * load to answer what `AppRouter` is.
 *
 * The walk follows type-only imports as well as value ones, because that is
 * what the compiler does. `import type` erases at runtime, so the value-graph
 * guard beside this one skips it — but the module is still parsed, bound and
 * checked, and its own value imports are still followed. Forty type-only
 * imports of forty composed-feature records is how the API application's whole
 * graph ended up inside the browser application's typecheck.
 *
 * Resolution is the workspace resolver's, so a third-party specifier is not
 * followed. The count is first-party source files only, which is the half a
 * change in this repository moves; it tracked `tsc --listFiles`'s own
 * workspace bucket exactly when both were measured.
 */
import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/workspace/layout.ts";
import { createWorkspaceModuleResolver, moduleImports } from "../src/workspace/module-graph.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The module a browser package names to get typed procedures. */
const APP_ROUTER_TYPES = join(REPO_ROOT, "apps", "api", "src", "app-trpc", "app-trpc.types.ts");

/**
 * Measured at 3,746 the day ADR-130 was written, after the composed-feature
 * records moved out of their compositions. It is a ceiling, not a target: the
 * target is under 500, which is what declaring `AppRouter` from the feature
 * contracts would leave. Lower it when a change earns it; never raise it
 * without saying in the commit what the graph bought.
 */
const CEILING = 3_850;

/**
 * The walk scans every workspace manifest and then thousands of files, so both
 * tests share one result. Building it twice doubles a slow test for nothing.
 */
let walked: ReadonlySet<string> | undefined;

function appRouterModules(): ReadonlySet<string> {
  walked ??= reachableWorkspaceModules({ roots: [APP_ROUTER_TYPES] });
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

describe("given a program names the API router type", () => {
  describe("when the modules it loads are counted", () => {
    /** @scenario "The router type's module graph stays under its ceiling" */
    it("stays under the recorded ceiling", { timeout: 120_000 }, () => {
      const reached = appRouterModules();

      expect(
        reached.size,
        `Naming AppRouter now loads ${reached.size} workspace source files (ceiling ${CEILING}). ` +
          "Something added a module to the router type's graph. See ADR-130.",
      ).toBeLessThan(CEILING);
    });
  });

  describe("when a feature's composed record is reached", () => {
    /** @scenario "A feature's composed record is reached without its composition" */
    it("does not reach the composition that builds it", { timeout: 120_000 }, () => {
      const reached = appRouterModules();
      // A feature whose record moved out of its composition has a
      // `.composition.types.ts` sibling. Reaching the composition again means
      // the record, or something the record names, was put back into it.
      const rejoined = [...reached].filter(
        (file) =>
          file.startsWith(join(REPO_ROOT, "apps", "api", "src", "features") + sep) &&
          file.endsWith(".composition.ts") &&
          existsSync(file.replace(/\.composition\.ts$/, ".composition.types.ts")),
      );

      expect(rejoined.map((file) => file.slice(REPO_ROOT.length + 1))).toEqual([]);
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
        apiFiles.map((file) => file.slice(REPO_ROOT.length + 1)).sort(),
        "The browser application reached the API application's source. Its typecheck now " +
          "compiles the API process. See ADR-130.",
      ).toEqual([]);
    });
  });
});

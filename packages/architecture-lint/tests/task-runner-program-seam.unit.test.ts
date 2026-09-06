/**
 * @vitest-environment node
 *
 * @see specs/setup/task-runner-program-seam.feature
 * @see dev/docs/adr/130-the-api-router-type-is-declared.md
 *
 * The same ratchet the router type carries, on the process that composes the
 * least: how many workspace source files the task runner has to load.
 *
 * The walk follows type-only imports as well as value ones, because that is
 * what the compiler does, and resolution is the workspace resolver's, so a
 * third-party specifier is not followed.
 */
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/files";
import { createWorkspaceModuleResolver, moduleImports } from "../src/module-graph";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Barrels the runner used to import for a single symbol each. Reaching one
 * again puts its whole package, and everything that package depends on, back
 * into the runner's program.
 */
const BARRELS_THE_RUNNER_DOES_NOT_NEED = [
  join(REPO_ROOT, "packages", "features", "scenario", "server", "src", "index.ts"),
  join(REPO_ROOT, "packages", "features", "trace", "server", "src", "index.ts"),
] as const;

/**
 * Measured at 2,191 the day the two barrels above were replaced by
 * `./composition/*` subpaths — the runner's own tests included, which the
 * compiler's own project excludes. It is a ceiling, not a target. Lower it
 * when a change earns it; never raise it without saying in the commit what
 * the graph bought.
 */
const CEILING = 2_300;

let walked: ReadonlySet<string> | undefined;

function taskRunnerModules(): ReadonlySet<string> {
  walked ??= reachableWorkspaceModules({
    roots: walkFiles(join(REPO_ROOT, "apps", "tasks", "src"), (path) => /\.tsx?$/.test(path)),
  });
  return walked;
}

/** Everything the compiler loads to answer what the modules at `roots` are. */
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

describe("given the task runner is compiled", () => {
  describe("when the modules its own program loads are walked", () => {
    /** @scenario "A composition imports the module it needs, not its feature's barrel" */
    it(
      "reaches no feature server barrel it only needed one module from",
      { timeout: 240_000 },
      () => {
        const reached = taskRunnerModules();

        const rejoined = BARRELS_THE_RUNNER_DOES_NOT_NEED.filter((barrel) => reached.has(barrel));

        expect(
          rejoined.map((file) => file.slice(REPO_ROOT.length + 1)),
          "The task runner reached a feature server barrel again. Import the module the " +
            "composition names through its `./composition/*` subpath instead.",
        ).toEqual([]);
      },
    );

    /** @scenario "The task runner's module graph stays under its ceiling" */
    it("stays under the recorded ceiling", { timeout: 240_000 }, () => {
      const reached = taskRunnerModules();

      const workspaceSource = [...reached].filter(
        (file) => !file.includes(`${sep}node_modules${sep}`),
      );

      expect(
        workspaceSource.length,
        `The task runner now loads ${workspaceSource.length} workspace source files ` +
          `(ceiling ${CEILING}). Something widened its graph.`,
      ).toBeLessThan(CEILING);
    });
  });
});

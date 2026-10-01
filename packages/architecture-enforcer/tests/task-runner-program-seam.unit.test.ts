/**
 * @vitest-environment node
 * The same ratchet the module procedure maps carry, on the task runner: what it loads beyond the
 * installed module list it boots, following type-only imports too.
 */
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkFiles } from "../src/workspace/layout.ts";
import { createWorkspaceModuleResolver, moduleImports } from "../src/workspace/module-graph.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The generated list every process boots (record section 4); the runner pays for it by design. */
const INSTALLED_MODULES = join(
  REPO_ROOT,
  "packages",
  "installed-server-modules",
  "src",
  "server-modules.generated.ts",
);

/**
 * Measured at 73 when the runner started booting the installed list in the tasks role (the
 * runner's own sources and tests included). A ceiling, not a target. Lower it when earned;
 * never raise it without saying why.
 */
const CEILING = 100;

const workspaceSource = (files: ReadonlySet<string>) =>
  new Set([...files].filter((file) => !file.includes(`${sep}node_modules${sep}`)));

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
    /** @scenario "The task runner's module graph stays under its ceiling" */
    it("loads little beyond the installed module list", { timeout: 240_000 }, () => {
      const runner = workspaceSource(
        reachableWorkspaceModules({
          roots: walkFiles(join(REPO_ROOT, "apps", "tasks", "src"), (path) => /\.tsx?$/.test(path)),
        }),
      );
      const installed = workspaceSource(reachableWorkspaceModules({ roots: [INSTALLED_MODULES] }));
      expect(runner.has(INSTALLED_MODULES)).toBe(true);

      const beyond = [...runner].filter((file) => !installed.has(file));

      expect(
        beyond.length,
        `The task runner now loads ${beyond.length} workspace source files beyond the installed ` +
          `module list (ceiling ${CEILING}). Something widened its own graph.`,
      ).toBeLessThan(CEILING);
    });
  });
});

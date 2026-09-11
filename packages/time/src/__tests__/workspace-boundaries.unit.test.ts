/**
 * The retired library cannot come back: nothing in the workspace imports it,
 * no manifest declares it, and the lint refuses a new import. Each process
 * and the browser install this package's polyfill once, as their first import.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const isRepoRoot = existsSync(join(dir, "pnpm-workspace.yaml"));
    if (isRepoRoot) return dir;

    const parent = dirname(dir);
    const reachedFilesystemRoot = parent === dir;
    if (reachedFilesystemRoot) {
      throw new Error(`pnpm-workspace.yaml not found above ${start}`);
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const SOURCE_ROOTS = ["apps", "packages", "sdks", "mcp", "services"];
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".next", "coverage"]);

function walk(directory: string, matches: (name: string) => boolean): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIR.has(entry.name) ? [] : walk(full, matches);
    }
    return matches(entry.name) ? [full] : [];
  });
}

// Split so this guard's own source never matches the pattern it looks for.
const RETIRED_LIBRARY = ["date", "fns"].join("-");
const IMPORT_RE = new RegExp(`from\\s+["']${RETIRED_LIBRARY}(?:/[^"']*)?["']`);

describe("the retired library cannot come back", () => {
  describe("given every first-party source file in the workspace", () => {
    // Walks every first-party source file and package manifest in the
    // workspace (apps, packages, sdks, mcp, services): thousands of files,
    // slower than the default 10s under vitest's fork pool.
    const WORKSPACE_SCAN_TIMEOUT_MS = 60_000;

    /** @scenario "No production file imports the retired date library" */
    it(
      "imports no date-fns module and declares it in no package manifest",
      () => {
        const sourceFiles = SOURCE_ROOTS.flatMap((root) =>
          walk(join(repoRoot, root), (name) => /\.tsx?$/.test(name)),
        );
        expect(sourceFiles.length).toBeGreaterThan(0);

        const importOffences = sourceFiles.filter((file) =>
          IMPORT_RE.test(readFileSync(file, "utf8")),
        );
        expect(importOffences).toEqual([]);

        const manifestFiles = SOURCE_ROOTS.flatMap((root) =>
          walk(join(repoRoot, root), (name) => name === "package.json"),
        );
        expect(manifestFiles.length).toBeGreaterThan(0);

        const manifestOffences = manifestFiles.filter((file) => {
          const manifest = JSON.parse(readFileSync(file, "utf8")) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
          };
          return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
            (deps) => Object.keys(deps ?? {}).includes(RETIRED_LIBRARY),
          );
        });
        expect(manifestOffences).toEqual([]);
      },
      WORKSPACE_SCAN_TIMEOUT_MS,
    );
  });

  describe("given the architecture lint configuration", () => {
    /** @scenario "The linter refuses a new import of the retired library" */
    it("names date-fns in a no-restricted-imports pattern with @langwatch/time as the remedy", () => {
      const config = readFileSync(join(repoRoot, "dev/lint/oxlint.baseline.jsonc"), "utf8");
      const groupMatch = config.match(
        /"group":\s*\[\s*"date-fns"\s*,\s*"date-fns\/\*"\s*\][^}]*"message":\s*"([^"]*)"/s,
      );

      expect(groupMatch).not.toBeNull();
      expect(groupMatch?.[1]).toContain("@langwatch/time");
    });
  });

  describe("given the API, worker, tasks and browser entrypoints", () => {
    /** @scenario "Each process and the browser install the polyfill at its entry" */
    it("imports the polyfill module exactly once, for its side effect, as its first import", () => {
      const entrypoints = [
        "apps/api/src/api.entrypoint.ts",
        "apps/worker/src/worker.entrypoint.ts",
        "apps/tasks/src/tasks.entrypoint.ts",
        "apps/ui/src/ui.entrypoint.tsx",
      ];
      const specifier = "@langwatch/time/polyfill";

      const offences = entrypoints.flatMap((relative) => {
        const source = readFileSync(join(repoRoot, relative), "utf8");
        const firstImportLine = source
          .split("\n")
          .map((line) => line.trim())
          .find(
            (line) =>
              line !== "" &&
              !line.startsWith("//") &&
              !line.startsWith("/*") &&
              !line.startsWith("*"),
          );
        const occurrences = source.split(`"${specifier}"`).length - 1;

        const problems: string[] = [];
        if (firstImportLine !== `import "${specifier}";`) {
          problems.push(`${relative}: first import is "${firstImportLine}", not the polyfill`);
        }
        if (occurrences !== 1) {
          problems.push(`${relative}: imports the polyfill ${occurrences} times, not once`);
        }
        return problems;
      });

      expect(offences).toEqual([]);
    });
  });
});

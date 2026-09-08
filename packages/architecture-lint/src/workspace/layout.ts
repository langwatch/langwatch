import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * What the repository tree is, spelled once: the roots a policy scans, the
 * directories no walk descends into, and the single walk that reads both.
 * Seven constants across seven policy files used to disagree about the last
 * of those, so two policies looking at "the workspace" saw different trees.
 */

/** Where a workspace package may be declared. Mirrors `pnpm-workspace.yaml`. */
export const WORKSPACE_ROOTS = [
  "apps",
  "packages",
  "sdks",
  "mcp",
  "plugins",
  "services",
  "skills",
];

/** The roots holding TypeScript the workspace itself owns and ships. */
export const SOURCE_ROOTS = ["apps", "mcp/typescript", "packages", "tools"] as const;

/** The roots whose folders the shape budget measures. */
export const PACKAGE_SOURCE_ROOTS = ["apps", "packages", "tools/dev-runtime"];

/** The process roots a boot scan reads to learn which feature installers run. */
export const BOOT_SCAN_ROOTS = [
  "apps/api/src",
  "apps/worker/src",
  "apps/tasks/src",
  "packages/enterprise/composition",
];

/**
 * Build output, dependencies, and tool state. A dot directory is excluded by
 * name rather than by list because agent worktrees live under `.claude/` and
 * `.codex/`: 165,000 TypeScript files from other checkouts of this same
 * repository, which a walk from the root would otherwise lint as if they were
 * this one.
 */
export const IGNORED_DIRECTORIES = new Set(["coverage", "dist", "node_modules"]);

/** Whether a walk descends into a directory of this name. */
export function isIgnoredDirectory({
  name,
  ignored,
}: {
  name: string;
  ignored?: ReadonlySet<string>;
}): boolean {
  if (name.startsWith(".")) return true;

  return IGNORED_DIRECTORIES.has(name) || ignored?.has(name) === true;
}

/**
 * Every file under `root` the filter accepts, sorted. The one walk in the
 * package: `WorkspaceSnapshot.files` caches its results for a run, and a
 * caller with its own tree (a test fixture, a migration tool) reads it here.
 */
export function walkFiles(
  root: string,
  accept: (path: string) => boolean,
  options?: { ignoredDirectories?: ReadonlySet<string> },
): string[] {
  const found: string[] = [];

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectory({ name: entry.name, ignored: options?.ignoredDirectories })) continue;

        visit(path);
      } else if (entry.isFile() && accept(path)) {
        found.push(path);
      }
    }
  };

  if (existsSync(root) && statSync(root).isDirectory()) visit(root);

  return found.sort();
}

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * What the repository tree is, spelled once: the roots a policy scans and the
 * directories no walk descends into. Seven policies used to disagree on this.
 */

/** Where a workspace package may be declared. Mirrors `pnpm-workspace.yaml`. */
export const WORKSPACE_ROOTS = [
  "apps",
  "modules",
  "enterprise",
  "packages",
  "sdks",
  "mcp",
  "plugins",
  "services",
  "skills",
];

/** The roots holding TypeScript the workspace itself owns and ships. */
export const SOURCE_ROOTS = [
  "apps",
  "enterprise",
  "mcp/typescript",
  "modules",
  "packages",
  "tools",
] as const;

/** The roots whose folders the shape budget measures. */
export const PACKAGE_SOURCE_ROOTS = [
  "apps",
  "enterprise",
  "modules",
  "packages",
  "tools/dev-runtime",
];

/** The process roots a boot scan reads to learn which feature installers run. */
export const BOOT_SCAN_ROOTS = [
  "apps/api/src",
  "apps/worker/src",
  "apps/tasks/src",
  "enterprise/packages/composition",
];

/**
 * Build output, dependencies, and tool state. Dot directories are excluded by
 * name because agent worktrees live under `.claude/`/`.codex/` and would
 * otherwise be walked as if they were this repository.
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
 * Every listing this reading of the workspace has already made, keyed by the
 * directory and the extra ignores it was walked with. One walk per directory
 * per run: before it, `apps/ui/src` was re-walked by seven policies.
 */
const listings = new Map<string, readonly string[]>();

/**
 * Every file under `directory` the filter accepts, from one walk per directory.
 * The seam every traversal goes through: `WorkspaceSnapshot.files` is this
 * function, and a policy holding no snapshot shares the same listing.
 */
export function listFiles({
  directory,
  accept,
  ignoredDirectories,
}: {
  directory: string;
  accept: (path: string) => boolean;
  ignoredDirectories?: ReadonlySet<string>;
}): readonly string[] {
  const key = `${directory}\0${[...(ignoredDirectories ?? [])].toSorted().join(",")}`;
  const known = listings.get(key);

  if (known) return known.filter(accept);

  const found = walkFiles(directory, () => true, { ignoredDirectories });
  listings.set(key, found);

  return found.filter(accept);
}

/**
 * Drop every memoised listing. A reading of the workspace starts from the tree
 * as it is now, so a fixture written between two readings is seen by the second.
 */
export function forgetFileListings(): void {
  listings.clear();
}

function collectFiles({
  directory,
  accept,
  ignored,
  found,
}: {
  directory: string;
  accept: (path: string) => boolean;
  ignored: ReadonlySet<string> | undefined;
  found: string[];
}): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isIgnoredDirectory({ name: entry.name, ignored })) {
        collectFiles({ directory: path, accept, ignored, found });
      }
      continue;
    }
    if (entry.isFile() && accept(path)) found.push(path);
  }
}

/**
 * Every file under `root` the filter accepts, sorted. The raw walk, behind
 * `listFiles`: a caller with its own tree — a test fixture, a migration tool —
 * reads it here, and nothing in `src/policies/**` calls it directly.
 */
export function walkFiles(
  root: string,
  accept: (path: string) => boolean,
  options?: { ignoredDirectories?: ReadonlySet<string> },
): string[] {
  const found: string[] = [];
  const ignored = options?.ignoredDirectories;

  if (existsSync(root)) {
    const stat = statSync(root);
    if (stat.isDirectory()) collectFiles({ directory: root, accept, ignored, found });
  }

  return found.toSorted();
}

/**
 * Split integration tests by needs: jsdom+no-datastore (component) vs datastore.
 * BOTH configs call one function for disjoint partition by construction.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Datastore markers via shallow file read (not imports): transitive reaches
 * fail loudly, forcing one-line fix.
 */
const DATASTORE_MARKERS = [
  "prisma",
  "clickhouse",
  "redis",
  "bullmq",
  "testcontainers",
  "createTestProject",
  "createTestOrganization",
  "startTestClickHouseEndpoints",
  "migrationReplay",
  "withReplayLock",
  "groupQueue",
  "event-sourcing/__tests__/integration",
] as const;

const DATASTORE_PATTERN = new RegExp(DATASTORE_MARKERS.join("|"), "i");

/** Vitest reads the environment from a docblock in the first comment block. */
const JSDOM_PATTERN = /@vitest-environment\s+jsdom/;

export type Lane = "component" | "datastore";

/**
 * Which lane a single file belongs to, given its source. Exported for the
 * guard test: the decision must be inspectable on a string without a
 * filesystem behind it, or it can't be tested at the level it is made.
 */
export function laneForSource(source: string): Lane {
  if (!JSDOM_PATTERN.test(source)) return "datastore";
  if (DATASTORE_PATTERN.test(source)) return "datastore";
  return "component";
}

const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", ".next-saas", "dist", "e2e"]);

const INTEGRATION_SUFFIX = /\.integration\.(test|spec)\.[cm]?[jt]sx?$/;

/** Whether the walk should descend into a directory entry. */
function shouldDescend(name: string): boolean {
  return !IGNORED_DIRECTORIES.has(name) && !name.startsWith(".");
}

/** The entries of `dir`, or none when it cannot be read. */
function readEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** One directory's entries, split into what to descend into and what to keep. */
function scanDirectory(dir: string): { descend: string[]; matched: string[] } {
  const descend: string[] = [];
  const matched: string[] = [];

  for (const entry of readEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldDescend(entry.name)) descend.push(full);
    } else if (INTEGRATION_SUFFIX.test(entry.name)) {
      matched.push(full);
    }
  }

  return { descend, matched };
}

/** Every integration test file under `root`, as paths relative to `root`. */
function collectIntegrationFiles(root: string, searchDirs: string[]): string[] {
  const found: string[] = [];
  const stack = searchDirs.map((dir) => path.join(root, dir)).filter((dir) => fs.existsSync(dir));

  while (stack.length) {
    const { descend, matched } = scanDirectory(stack.pop()!);
    stack.push(...descend);
    found.push(...matched.map((file) => path.relative(root, file)));
  }

  // Sorted so both configs, in separate processes, walk the identical list.
  return found.sort();
}

/** The trees the app's integration tests live in. */
export const INTEGRATION_SEARCH_DIRS = ["src", "ee"] as const;

export interface LanePartition {
  /** Relative paths that need no datastore. */
  component: string[];
  /** Relative paths that do. */
  datastore: string[];
}

/**
 * Partition every integration test file under `root` into the two lanes.
 * Reads each file once (~1024 small reads, well under a second) — a
 * rounding error against the ~145s of container setup the component lane skips.
 */
export function partitionIntegrationFiles({
  root,
  searchDirs = [...INTEGRATION_SEARCH_DIRS],
}: {
  root: string;
  searchDirs?: string[];
}): LanePartition {
  const component: string[] = [];
  const datastore: string[] = [];

  for (const relative of collectIntegrationFiles(root, searchDirs)) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(root, relative), "utf8");
    } catch {
      // Unreadable is not evidence of safety. Send it to the lane that has
      // everything, and let the run report the real problem.
      datastore.push(relative);
      continue;
    }
    (laneForSource(source) === "component" ? component : datastore).push(relative);
  }

  return { component, datastore };
}

/**
 * Glob metacharacters: twelve tests under `[project]/` fail silently if
 * unescaped (char class, not literal).
 */
const GLOB_METACHARACTERS = /[\\*?[\]{}()!+@|]/g;

/** A literal path, as a glob that matches only itself. */
export function escapeGlob(path: string): string {
  return path.replace(GLOB_METACHARACTERS, "\\$&");
}

/**
 * A lane's file list as vitest `include` patterns. Vitest has no "exactly
 * these files" option — `include` is globs — so the exact list must survive
 * being read as one.
 */
export function toIncludePatterns(files: string[]): string[] {
  return files.map(escapeGlob);
}

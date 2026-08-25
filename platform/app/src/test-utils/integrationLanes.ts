/**
 * Splits the `.integration.test.*` files into the two lanes CI runs them in.
 *
 * The suffix is a statement about test LEVEL — renders a component, mocks its
 * boundaries — and CLAUDE.md is right that such a test is not a unit test. But
 * CI had been reading the suffix as a request for INFRASTRUCTURE, and so booted
 * Postgres, ClickHouse and Redis, ran Prisma migrations, installed goose,
 * replayed the ClickHouse schema and set up Helm before running files that
 * render React into jsdom and never open a socket. Measured on the six shards:
 * 540 of 1017 files declared jsdom and named no datastore at all.
 *
 * So the lane is decided by what a file NEEDS, not by what it is called:
 *
 *   component lane — jsdom, names no datastore. No service containers, no
 *                    migrations, files run concurrently with a shared module
 *                    registry, exactly like the unit lane.
 *   datastore lane — everything else. Containers, migrations, serial files.
 *
 * BOTH configs call this one function, so the two lanes are a total and
 * disjoint partition by construction. A file cannot be dropped from the run or
 * picked up twice, which is the failure mode a hand-maintained list would have.
 *
 * The rule is deliberately conservative and the default is the datastore lane:
 * a file only leaves it by positively declaring jsdom and mentioning no
 * datastore. A misjudgement therefore costs time, never correctness — and a new
 * test lands in the safe lane without anyone having to remember a convention.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Names that mean a file expects a real datastore, a real queue, or the
 * integration harness that provisions them.
 *
 * A shallow read of the file's own source, not of its import graph. That is
 * sound in the direction that matters: a file reaching a datastore only
 * transitively — through a helper it imports — cannot pass in the component
 * lane, because there is no datastore to reach. It fails loudly on the first CI
 * run rather than passing for the wrong reason, and moving it back is a
 * one-line change to the file, not to this rule.
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
 * Which lane a single file belongs to, given its source.
 *
 * Exported for the guard test: the decision has to be inspectable on a string
 * without a filesystem behind it, or it cannot be tested at the level it is
 * made.
 */
export function laneForSource(source: string): Lane {
  if (!JSDOM_PATTERN.test(source)) return "datastore";
  if (DATASTORE_PATTERN.test(source)) return "datastore";
  return "component";
}

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".next-saas",
  "dist",
  "e2e",
]);

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
  const stack = searchDirs
    .map((dir) => path.join(root, dir))
    .filter((dir) => fs.existsSync(dir));

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
 *
 * Reads each file once. That is ~1024 small reads and lands well under a second
 * — a rounding error against the ~145s of container setup the component lane no
 * longer pays for, let alone the compile it skips.
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
 * Characters picomatch reads as pattern syntax rather than as themselves.
 *
 * This is not hypothetical tidiness. Twelve of the app's integration tests live
 * under `src/pages/[project]/`, and handed to a glob engine unescaped,
 * `[project]` is a CHARACTER CLASS matching one of p/r/o/j/e/c/t — so it does
 * not match the directory literally named `[project]`, and those twelve files
 * would be selected by neither lane. They would simply stop running, and both
 * lanes would report a clean pass over the files that remained.
 */
const GLOB_METACHARACTERS = /[\\*?[\]{}()!+@|]/g;

/** A literal path, as a glob that matches only itself. */
export function escapeGlob(path: string): string {
  return path.replace(GLOB_METACHARACTERS, "\\$&");
}

/**
 * A lane's file list as vitest `include` patterns.
 *
 * Vitest has no "exactly these files" option — `include` is globs — so the
 * exact list has to survive being read as one.
 */
export function toIncludePatterns(files: string[]): string[] {
  return files.map(escapeGlob);
}

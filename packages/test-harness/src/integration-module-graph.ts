/**
 * Module graph partition: mocking (fresh registry) vs shared (isolate:false).
 * Avoids teardown/vi.mock conflicts. Import is 42% of lane time.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Module mock pattern: vi.mock/doMock/hoisted. Shallow read (transitive
 * reaches fail loudly).
 */
const MODULE_MOCK_PATTERN = /\bvi\s*\.\s*(mock|doMock|hoisted)\s*\(/;

export type GraphLane = "mocking" | "shared";

/**
 * Which graph lane a single file belongs to, given its source. Exported for
 * the guard test: the decision must be inspectable on a string without a
 * filesystem behind it, or it can't be tested at the level it is made.
 */
export function graphLaneForSource(source: string): GraphLane {
  return MODULE_MOCK_PATTERN.test(source) ? "mocking" : "shared";
}

export interface GraphPartition {
  /** Relative paths that mock a module and so need a fresh registry. */
  mocking: string[];
  /** Relative paths that do not, and can share one. */
  shared: string[];
}

/**
 * Partition already-selected datastore files by graph lane. Takes the file
 * list, not a tree walk, so this composes with partitionIntegrationFiles —
 * the two partitions can never disagree about which files exist.
 */
export function partitionByModuleGraph({
  root,
  files,
}: {
  root: string;
  files: string[];
}): GraphPartition {
  const mocking: string[] = [];
  const shared: string[] = [];

  for (const relative of files) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(root, relative), "utf8");
    } catch {
      // Unreadable is not evidence that sharing is safe. Send it to the lane
      // that behaves as today and let the run report the real problem.
      mocking.push(relative);
      continue;
    }
    (graphLaneForSource(source) === "shared" ? shared : mocking).push(relative);
  }

  return { mocking, shared };
}

/**
 * The lane this process was asked to run, or null for "both". Null is the
 * local default (every file with a fresh registry, identical to before this
 * split), so a plain `pnpm test:integration <path>` is unchanged; CI sets it.
 */
export function selectedGraphLane(env: NodeJS.ProcessEnv): GraphLane | null {
  const value = env.INTEGRATION_GRAPH_LANE;
  if (value === "mocking" || value === "shared") return value;
  return null;
}

/**
 * The files to run, and whether they may share a registry — one function so
 * `include` and `isolate` derive from the same decision. Splitting them is
 * how mocking files end up sharing a graph, the failure this file prevents.
 */
export function graphLaneSelection({
  root,
  datastoreFiles,
  env,
}: {
  root: string;
  datastoreFiles: string[];
  env: NodeJS.ProcessEnv;
}): { files: string[]; isolate: boolean } {
  const lane = selectedGraphLane(env);
  if (lane === null) return { files: datastoreFiles, isolate: true };

  const partition = partitionByModuleGraph({ root, files: datastoreFiles });
  return lane === "shared"
    ? { files: partition.shared, isolate: false }
    : { files: partition.mocking, isolate: true };
}

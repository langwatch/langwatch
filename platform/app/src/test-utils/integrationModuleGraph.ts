/**
 * Splits the datastore lane again, by whether a file can tolerate a shared
 * module registry.
 *
 * Import is the largest single line item in this suite: ~216s against ~203s of
 * actual test execution on a CI shard, 42% of the lane's runner time, roughly
 * 1.6s per file rebuilding the same Prisma client and the same server graph.
 * `isolate: false` reclaims most of it. Measured against native local services:
 *
 *   src/app/api    (49 files)  138.8s -> 43.9s   import 72.1s -> 11.9s  (-84%)
 *   ee/governance  (23 files)   44.1s -> 17.3s   import 23.1s ->  9.9s  (-57%)
 *
 * Two things stood in the way, and only one of them was the one everybody
 * assumed.
 *
 * The teardown, which is fixed rather than partitioned around: `setup.ts` is a
 * setup FILE, so its `afterAll` runs once per test FILE, and it disconnected
 * Prisma and quit the app-layer Redis — the two singletons a shared graph
 * exists to keep. With a fresh registry that is correct and load-bearing, since
 * those sockets would otherwise pin the worker open past the last test. With a
 * shared one it hands the next file a dead client. That is the "first file's
 * teardown takes the next file's client with it" failure.
 *
 * `vi.mock`, which no teardown reaches and which this file exists for. Vitest
 * hoists a module mock per test file and applies it while building THAT FILE's
 * registry. Share the registry and a module an earlier file already
 * instantiated stays unmocked, so the test calls the real collaborator. The
 * symptom is `ECONNREFUSED` and `expected 500 to be 200` — nothing about
 * containers or clients, which is exactly what sends people looking in the
 * wrong place. 123 of the 414 integration files mock a module, so this is not a
 * set to rewrite and not a single `isolate` for the whole lane.
 *
 * So it is a partition, on the same terms as the component/datastore split in
 * integrationLanes.ts:
 *
 *   mocking lane — calls `vi.mock`. Fresh registry per file, exactly as today.
 *   shared lane  — does not. One registry for the whole shard.
 *
 * The default is the MOCKING lane, and the rule is conservative in the same
 * direction as the one it nests inside: a file leaves only by positively
 * containing no `vi.mock`. A misjudgement costs time, never correctness.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * A call to vitest's module mocker, in any of the spellings that hoist.
 *
 * `vi.mock` and `vi.doMock` are the two that replace a module in the registry.
 * `vi.hoisted` is included because its whole purpose is to run before the
 * imports a mock factory closes over, so a file using it is a file whose
 * mocking is registry-shaped even when the `vi.mock` sits behind an alias.
 *
 * A shallow read of the file's own source, not of its import graph — the same
 * soundness argument as DATASTORE_MARKERS: a file that mocks only through a
 * helper cannot pass in the shared lane, so it fails loudly on the first run
 * rather than passing for the wrong reason.
 */
const MODULE_MOCK_PATTERN = /\bvi\s*\.\s*(mock|doMock|hoisted)\s*\(/;

export type GraphLane = "mocking" | "shared";

/**
 * Which graph lane a single file belongs to, given its source.
 *
 * Exported for the guard test: the decision has to be inspectable on a string
 * without a filesystem behind it, or it cannot be tested at the level it is
 * made.
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
 * Partition already-selected datastore files by graph lane.
 *
 * Takes the file list rather than walking the tree, so this composes with
 * partitionIntegrationFiles instead of duplicating its walk — and so the two
 * partitions cannot disagree about which files exist.
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
 * The lane this process was asked to run, or null for "both".
 *
 * Null is the local default and runs every datastore file with a fresh
 * registry — identical to the behaviour before this split, so a plain
 * `pnpm test:integration <path>` on a laptop is unchanged and no one has to
 * know the lane exists. CI sets the variable and gets the two lanes.
 */
export function selectedGraphLane(env: NodeJS.ProcessEnv): GraphLane | null {
  const value = env.INTEGRATION_GRAPH_LANE;
  if (value === "mocking" || value === "shared") return value;
  return null;
}

/**
 * The files to run, and whether they may share a registry.
 *
 * One function so `include` and `isolate` are derived from the same decision.
 * Splitting them is how a lane ends up running the mocking files with a shared
 * graph, which is the failure this whole file exists to prevent.
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

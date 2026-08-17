/**
 * Whether the integration suite reuses one module graph across its files, and
 * the teardown rule that makes that safe.
 *
 * Import is the largest single line item in this suite. Measured across the CI
 * shards it is ~216s against ~203s of actual test execution — 42% of the lane's
 * runner time, roughly 1.6s per file spent rebuilding the same Prisma client
 * and the same server graph. Sharing the registry reclaims most of it.
 *
 * The reason it could not simply be switched on is the teardown, not the
 * sharing. `setup.ts` is a SETUP FILE, so its `afterAll` runs once per test
 * FILE, and that hook disconnects Prisma and quits the app-layer Redis — the
 * two singletons the shared graph is meant to keep. With a fresh registry per
 * file that is correct and necessary: the sockets would otherwise pin the
 * worker open past the last test and the CI step would hit its job cap. With a
 * shared registry it is exactly wrong, because the singletons outlive the file
 * that closed them, and the next file resolves a disconnected client. That is
 * the "first file's teardown takes the next file's client with it" failure —
 * ECONNREFUSED, "Cannot resolve ClickHouse client", "App not initialized".
 *
 * So the two settings are one decision and live here together:
 *
 *   shared graph  →  per-file teardown resets ONLY the App (whose lifecycle
 *                    genuinely is per file), and the process-wide singletons
 *                    are closed once, when the worker is finishing.
 *   fresh graph   →  per-file teardown closes everything, as before.
 *
 * `fileParallelism` is a separate decision with a separate reason — shared
 * ClickHouse and Redis INSTANCES rather than shared module state — and lives in
 * integrationFileConcurrency.ts. Files still run one at a time either way.
 */

/**
 * OFF, and the reason is `vi.mock` rather than anything above.
 *
 * The teardown described above is real and is implemented — it was the blocker
 * everyone assumed, and with it in place the sharing works and the numbers are
 * large. Measured on this branch against native local services:
 *
 *   src/app/api (49 files)   138.8s -> 43.9s   import 72.1s -> 11.9s  (-84%)
 *   ee/governance (23 files)  44.1s -> 17.3s   import 23.1s ->  9.9s  (-57%)
 *
 * But eight files in the app/api slice fail with the graph shared, and each one
 * PASSES ALONE. They are not broken; they are contaminated. The cause is
 * `vi.mock`: vitest hoists a module mock per test file and applies it while
 * building that file's registry, so when the registry is shared and an earlier
 * file already instantiated the real module, the mock never takes. The test
 * then calls the real collaborator — which is why the failures are
 * `ECONNREFUSED ::1:5560` and `expected 500 to be 200` rather than anything
 * about containers or clients.
 *
 * 123 of the 414 integration files call `vi.mock`. That is not a set to
 * rewrite, and no teardown fixes it, so a single `isolate` for the whole lane
 * cannot be the answer.
 *
 * The shape that would work is a partition, exactly like the component and
 * datastore lanes in integrationLanes.ts: files that call `vi.mock` keep a
 * fresh registry, files that do not share one. That is ~291 files getting the
 * speedup above and ~123 keeping today's behaviour, and it needs a second
 * vitest project plus its own CI lane — a real change, and a separate one.
 *
 * Left wired up rather than deleted so the next attempt starts from the
 * measurement rather than from the assumption this file used to record.
 */
export const INTEGRATION_FILES_SHARE_MODULE_GRAPH = false;

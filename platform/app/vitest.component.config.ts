/**
 * The lane for `.integration.test.*` files that need no datastore.
 *
 * 548 of the app's 1024 integration files declare jsdom and name no database,
 * queue or cache: they render a component and mock their boundaries. They were
 * running on the datastore lane — one serial fork worker on a 4-vCPU runner
 * that was simultaneously hosting Postgres, ClickHouse and Redis, after Prisma
 * migrations, a goose install, a ClickHouse schema replay and a Helm setup.
 *
 * Those files want most of what the UNIT lane already provides: forked VM
 * workers, concurrent files and no services at all. So this config IS the unit
 * config, with the file selection swapped and one setting overridden (`isolate`
 * — see below). Deriving it rather than copying it is the point: pool, worker
 * count, memory limit, sequencer, aliases and the fs allowlist stay defined
 * once, and a future change to the unit lane's memory behaviour cannot silently
 * miss this one.
 *
 * Which files land here is decided by src/test-utils/integrationLanes.ts, which
 * the datastore config calls too, so the two lanes are complements by
 * construction. See specs/ci/integration-test-lanes.feature.
 */
import { defineConfig } from "vitest/config";

import {
  INTEGRATION_SEARCH_DIRS,
  partitionIntegrationFiles,
  toIncludePatterns,
} from "./src/test-utils/integrationLanes";
import unitConfig from "./vitest.config";

const { component } = partitionIntegrationFiles({
  root: __dirname,
  searchDirs: [...INTEGRATION_SEARCH_DIRS],
});

const unitTest = unitConfig.test ?? {};

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitTest,
    // Name the files outright rather than globbing the suffix and excluding the
    // rest: the partition is already an exact list, and handing it over as one
    // removes any chance of the include glob and the lane rule disagreeing.
    // Escaped, because `src/pages/[project]/...` is a character class to a glob
    // engine and would match none of the twelve files that live there.
    include: toIncludePatterns(component),
    // The unit config excludes every `*.integration.test.*` file, which is
    // precisely what this lane runs. Drop that one entry and keep the rest.
    exclude: (unitTest.exclude ?? []).filter(
      (pattern) => pattern !== "**/*.integration.test.{ts,tsx}",
    ),
    // The ONE setting deliberately not inherited from the unit lane.
    //
    // The unit lane reuses one module registry across the files in a worker,
    // and that is load-bearing for its 1,688 files. This lane will not, because
    // it was measured and the reuse is not free here:
    //
    //   isolate: false -> 545 of 546 files pass, and a DIFFERENT file fails
    //                     each run (GlobalUpgradeModal and
    //                     LangyComposerRecordedTurn one run; SavedChartsToolbar
    //                     the next). Every one of them passes in isolation.
    //   isolate: true  -> 546 of 546, 3,987 tests, twice running.
    //
    // The files that move are React component suites, and a shared registry
    // makes "has this lazy chunk loaded yet" and "what is in this zustand
    // store" into GLOBAL state that the file order decides. That is a rotating
    // one-file flake, which is the most expensive kind of red: it blames an
    // innocent file and it does not reproduce.
    //
    // Nothing about the lane's purpose needs the reuse. The win is not paying
    // for a Postgres, a ClickHouse, a Redis, two migrations and a Helm setup to
    // render a button, and running the files concurrently instead of one at a
    // time — both of which stand. Registry reuse was inherited, not chosen; a
    // deterministic suite is worth more than the import time it saves.
    isolate: true,
  },
});

// A note on the pool, which is inherited from the unit lane. `pool: "forks"`
// looks like the conservative choice — these files ran on forks under the
// integration config for their whole history — but it was measured and it is
// worse: forks + a shared registry failed 87 of 236 files in src/components,
// against 4 under vmForks. They had run on forks with isolation ON, and reusing
// a registry inside a plain process is what leaks module state between files.
//
// That measurement is why the pool stays as inherited. It is also what pointed
// at `isolate` above being the setting that actually mattered here.

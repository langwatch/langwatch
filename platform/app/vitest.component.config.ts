/**
 * The lane for `.integration.test.*` files that need no datastore.
 *
 * 548 of the app's 1024 integration files declare jsdom and name no database,
 * queue or cache: they render a component and mock their boundaries. They were
 * running on the datastore lane — one serial fork worker on a 4-vCPU runner
 * that was simultaneously hosting Postgres, ClickHouse and Redis, after Prisma
 * migrations, a goose install, a ClickHouse schema replay and a Helm setup.
 *
 * Those files want exactly what the UNIT lane already provides: forked VM
 * workers, a reused module registry, concurrent files and no services at all.
 * So this config IS the unit config, with the file selection swapped. Deriving
 * it rather than copying it is the point — pool, worker count, memory limit,
 * sequencer, aliases and the fs allowlist stay defined once, and a future
 * change to the unit lane's memory behaviour cannot silently miss this one.
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
  },
});

// A note on the pool, which is inherited from the unit lane and must stay that
// way. The obvious-looking alternative is `pool: "forks"`, on the reasoning
// that these files ran on forks under the integration config for their whole
// history and a move should not change the environment. Measured, that is
// backwards: forks + isolate:false failed 87 of 236 files in src/components,
// against 4 under vmForks.
//
// The reason is that they ran on forks with isolate:TRUE — a fresh module
// registry per file. Reusing one registry inside a plain process is what leaks
// module state between files; a VM context is what makes reuse survivable, and
// it is why the unit lane runs 1,688 files this way. The two settings are a
// pair, not independent knobs.

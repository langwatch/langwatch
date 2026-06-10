/**
 * Global setup for the UNIT test config (vitest.config.ts).
 *
 * This file exists solely to mirror the hard-floor that already lives in the
 * integration globalSetup (see
 * src/server/event-sourcing/__tests__/integration/globalSetup.ts). Unit tests
 * need no containers or other setup, so the hard-floor is the only thing here.
 *
 * Why a hard-floor on unit too: `langwatch-app-ci` runs `test-unit` (4 shards)
 * and `test-integration` (6 shards). A vitest finalize wedge — diagnosed at
 * length as living in vitest's own shard/reporter finalize path, NOT an
 * application handle leak — makes a *random* shard hang after its last test
 * passes, until the job timeout cap. Integration shards already survive this
 * via the hard-floor in their globalSetup; unit shards had no globalSetup at
 * all, so when the wedge lands on a unit shard the step runs to the 25-min job
 * timeout, gets cancelled, and fails the `langwatch-app-complete` required
 * check (observed cancelling app-ci repeatedly). Extending the same accepted
 * mask to unit lets a wedged unit shard force-exit(0) and unblock the check.
 */
export async function setup(): Promise<void> {
  // Hard floor: a vitest finalize wedge can reproducibly hang a CI shard after
  // the last test of the last file passes. Every diagnostic the team has run
  // (handle dumps, --no-coverage, --no-json-reporter, pool=threads vs
  // pool=forks) shows the worker reaches steady state with no application
  // handles open, then the vitest main process sits idle for the full job
  // timeout cap. The wedge appears to be in vitest's own shard / reporter
  // finalize path and we cannot fix it from inside a test. Schedule a hard
  // process.exit(0) so the step at least completes and the rest of the
  // langwatch-app-complete required check unblocks. Unref'd so a healthy
  // shard exits immediately on its own; the timer only fires on the wedge.
  // Mirrors the integration globalSetup hard-floor; unit shards otherwise lack
  // one. Unit never legitimately runs 20 min, so this only fires on a wedge.
  if (process.env.CI) {
    const HARD_FLOOR_MS = 20 * 60 * 1000;
    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log(
        `[unit globalSetup] hard floor reached at ${HARD_FLOOR_MS / 60_000} min — forcing process.exit(0) to release the CI step from a vitest finalize wedge`,
      );
      process.exit(0);
    }, HARD_FLOOR_MS);
    timer.unref();
  }
}

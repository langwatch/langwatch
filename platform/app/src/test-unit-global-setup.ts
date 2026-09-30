/**
 * Global setup for the UNIT test config (vitest.config.ts).
 *
 * This file exists solely to mirror the hard-floor that already lives in the
 * integration globalSetup (see
 * src/server/event-sourcing/__tests__/integration/globalSetup.ts). Unit tests
 * need no containers or other setup, so the hard-floor is the only thing here.
 *
 * Why a hard-floor on unit too: `langwatch-app-ci` runs `test-unit` (4 shards)
 * and `test-integration` (6 shards). A vitest finalize wedge, diagnosed at
 * length as living in vitest's own shard/reporter finalize path and NOT an
 * application handle leak, makes a *random* shard hang after its last test
 * passes, until the job timeout cap. Integration shards already survive this
 * via the hard-floor in their globalSetup; unit shards had no globalSetup at
 * all, so when the wedge lands on a unit shard the step runs to the 25-min job
 * timeout, gets cancelled, and fails the `langwatch-app-complete` required
 * check (observed cancelling app-ci repeatedly). Extending the same accepted
 * mask to unit lets a wedged unit shard force-exit and unblock the check.
 */
import { relative } from "node:path";

import {
  hardFloorReport,
  shardModuleTally,
  shardSawFailure,
} from "./test-utils/shardFailureReporter";

/**
 * A healthy unit shard finishes in ~3 min, so a 4-min floor only fires on a
 * wedge and caps the wasted wall-clock at ~1 min of idle.
 */
const DEFAULT_HARD_FLOOR_MS = 4 * 60 * 1000;

/**
 * How long the shard may stay alive before the floor fires, or null to leave
 * it disarmed. LANGWATCH_UNIT_HARD_FLOOR_MS both shortens the floor and arms
 * it outside CI, which is how the exit path is exercised on a laptop: `CI=1`
 * would also flip pool sizing, worker memory, and, in the integration config,
 * testcontainers.
 *
 * A value that is not a positive number is announced rather than dropped. It
 * leaves the floor disarmed outside CI and back on the default inside it,
 * which looks exactly like the variable working, so the one line here is all
 * the signal a typo ever gets.
 */
export function resolveHardFloorMs(): number | null {
  const raw = process.env.LANGWATCH_UNIT_HARD_FLOOR_MS?.trim();
  const override = Number(raw);
  if (Number.isFinite(override) && override > 0) return override;

  if (raw) {
    // eslint-disable-next-line no-console
    console.warn(
      `[unit globalSetup] LANGWATCH_UNIT_HARD_FLOOR_MS is "${raw}", which is not a positive number of milliseconds, so it was ignored`,
    );
  }

  return process.env.CI ? DEFAULT_HARD_FLOOR_MS : null;
}

export async function setup(): Promise<void> {
  // Hard floor: a vitest finalize wedge can reproducibly hang a CI shard after
  // the last test of the last file passes. Every diagnostic the team has run
  // (handle dumps, --no-coverage, --no-json-reporter, pool=threads vs
  // pool=forks) shows the worker reaches steady state with no application
  // handles open, then the vitest main process sits idle for the full job
  // timeout cap. The wedge appears to be in vitest's own shard / reporter
  // finalize path and we cannot fix it from inside a test. Schedule a hard
  // process.exit so the step at least completes and the rest of the
  // langwatch-app-complete required check unblocks. Unref'd so a healthy
  // shard exits immediately on its own; the timer only fires on the wedge.
  // Mirrors the integration globalSetup hard-floor; unit shards otherwise lack
  // one.
  //
  // The exit code preserves what the shard already knew, because the wedge
  // also fires over a shard that never got a clean result, and a bare exit(0)
  // there stamps a green job over red or unrun tests. ShardFailureReporter
  // (wired via --reporter in the CI step) records both as results stream:
  // any failed test, and any file vitest started that never reported back.
  const hardFloorMs = resolveHardFloorMs();
  if (hardFloorMs === null) return;

  const timer = setTimeout(() => {
    const tally = shardModuleTally();
    const { exitCode, lines } = hardFloorReport({
      hardFloorMs,
      sawFailure: shardSawFailure(),
      modules: {
        ...tally,
        unreportedFiles: tally.unreportedFiles.map((moduleId) =>
          relative(process.cwd(), moduleId),
        ),
      },
    });
    for (const line of lines) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    process.exit(exitCode);
  }, hardFloorMs);
  timer.unref();
}
